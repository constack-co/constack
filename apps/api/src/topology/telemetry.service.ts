import { Injectable } from '@nestjs/common';
import { CoreV1Api, CustomObjectsApi, KubeConfig, type V1Service } from '@kubernetes/client-node';
import type { Capabilities, Relationship, Resource } from '@constack/shared-types';

type TelemetryCapabilities = NonNullable<Capabilities['telemetry']>;
type PrometheusVector = { metric: Record<string, string>; value?: [number, string] };
type PrometheusResponse = {
  status: string;
  data?: { resultType?: string; result?: PrometheusVector[] };
};

interface PrometheusTarget {
  id: string;
  name: string;
  namespace: string;
  url: string;
}

@Injectable()
export class TelemetryService {
  private readonly kubeConfig = new KubeConfig();
  private capabilitiesCache?: {
    expiresAt: number;
    value: TelemetryCapabilities;
    prometheus?: PrometheusTarget;
  };
  private trafficCache?: { expiresAt: number; value: Relationship[] };

  constructor() {
    try {
      this.kubeConfig.loadFromDefault();
    } catch {
      // Capability discovery reports explicit unavailable states outside Kubernetes.
    }
  }

  async capabilities(): Promise<TelemetryCapabilities> {
    if (this.capabilitiesCache && this.capabilitiesCache.expiresAt > Date.now())
      return this.capabilitiesCache.value;

    const providers: TelemetryCapabilities['providers'] = [];
    const metricsApi = await this.detectMetricsApi();
    if (metricsApi)
      providers.push({
        id: 'kubernetes-metrics',
        type: 'kubernetes-metrics',
        name: 'Kubernetes Metrics API',
        capabilities: ['metrics'],
      });

    const prometheus = await this.detectPrometheus();
    let prometheusTraffic = false;
    if (prometheus) {
      prometheusTraffic = await this.hasIstioTrafficMetrics(prometheus);
      providers.push({
        id: prometheus.id,
        type: 'prometheus',
        name: prometheus.name,
        namespace: prometheus.namespace,
        capabilities: prometheusTraffic ? ['metrics', 'traffic'] : ['metrics'],
      });
    }

    const value: TelemetryCapabilities = {
      providers,
      metrics: metricsApi
        ? { available: true, provider: 'Kubernetes Metrics API' }
        : prometheus
          ? { available: true, provider: prometheus.name }
          : {
              available: false,
              reason:
                'Neither the Kubernetes Metrics API nor an in-cluster Prometheus-compatible service was detected.',
            },
      traffic:
        prometheusTraffic && prometheus
          ? { available: true, provider: `${prometheus.name} (Istio request metrics)` }
          : {
              available: false,
              reason: prometheus
                ? 'Prometheus is available, but no supported workload-to-workload request metric was found.'
                : 'No compatible in-cluster traffic telemetry provider was detected.',
            },
      traces: { available: false, reason: 'No supported trace provider was detected.' },
    };
    this.capabilitiesCache = {
      expiresAt: Date.now() + 60_000,
      value,
      ...(prometheus ? { prometheus } : {}),
    };
    return value;
  }

  async prometheusMetrics(resource: Resource): Promise<Record<string, unknown> | undefined> {
    await this.capabilities();
    const target = this.capabilitiesCache?.prometheus;
    if (
      !target ||
      !resource.namespace ||
      !['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'Job'].includes(resource.kind)
    )
      return undefined;

    const podMatcher =
      resource.kind === 'Pod'
        ? escapePrometheusString(resource.name)
        : `${escapePrometheusRegex(resource.name)}-.*`;
    const selector = `namespace="${escapePrometheusString(resource.namespace)}",pod=~"${podMatcher}"`;
    const queries = {
      cpuCores: `sum(rate(container_cpu_usage_seconds_total{${selector},container!="",image!=""}[5m]))`,
      memoryBytes: `sum(container_memory_working_set_bytes{${selector},container!="",image!=""})`,
      networkReceiveBytesPerSecond: `sum(rate(container_network_receive_bytes_total{${selector}}[5m]))`,
      networkTransmitBytesPerSecond: `sum(rate(container_network_transmit_bytes_total{${selector}}[5m]))`,
    };
    const entries = await Promise.all(
      Object.entries(queries).map(
        async ([key, query]) => [key, firstValue(await this.query(target, query))] as const,
      ),
    );
    return {
      provider: target.name,
      observedAt: new Date().toISOString(),
      values: Object.fromEntries(
        entries.filter((entry): entry is readonly [string, number] => entry[1] !== undefined),
      ),
    };
  }

  async trafficRelationships(resources: ReadonlyArray<Resource>): Promise<Relationship[]> {
    if (this.trafficCache && this.trafficCache.expiresAt > Date.now())
      return this.trafficCache.value;
    const capabilities = await this.capabilities();
    const target = this.capabilitiesCache?.prometheus;
    if (!capabilities.traffic.available || !target) return [];

    const response = await this.query(
      target,
      'sum(rate(istio_requests_total[5m])) by (source_workload,source_workload_namespace,destination_workload,destination_workload_namespace,response_code)',
    );
    const byWorkload = new Map(
      resources
        .filter((resource) => ['Deployment', 'StatefulSet', 'DaemonSet'].includes(resource.kind))
        .map((resource) => [`${resource.namespace ?? ''}:${resource.name}`, resource]),
    );
    const aggregate = new Map<
      string,
      { source: Resource; target: Resource; requestsPerSecond: number; errorsPerSecond: number }
    >();
    for (const result of response.data?.result ?? []) {
      const source = byWorkload.get(
        `${result.metric.source_workload_namespace ?? ''}:${result.metric.source_workload ?? ''}`,
      );
      const destination = byWorkload.get(
        `${result.metric.destination_workload_namespace ?? ''}:${result.metric.destination_workload ?? ''}`,
      );
      const value = vectorValue(result);
      if (!source || !destination || source.id === destination.id || value === undefined) continue;
      const key = `${source.id}:${destination.id}`;
      const current = aggregate.get(key) ?? {
        source,
        target: destination,
        requestsPerSecond: 0,
        errorsPerSecond: 0,
      };
      current.requestsPerSecond += value;
      if (/^5/.test(result.metric.response_code ?? '')) current.errorsPerSecond += value;
      aggregate.set(key, current);
    }
    const relationships = [...aggregate.values()]
      .map(({ source, target: destination, requestsPerSecond, errorsPerSecond }) => {
        const errorRate = requestsPerSecond > 0 ? errorsPerSecond / requestsPerSecond : 0;
        return {
          id: `traffic:${source.id}:${destination.id}`,
          clusterId: source.clusterId,
          source: source.id,
          target: destination.id,
          type: 'traffic' as const,
          health: errorRate >= 0.05 ? ('degraded' as const) : ('healthy' as const),
          metadata: {
            provider: target.name,
            requestsPerSecond,
            errorRate,
            window: '5m',
            observedAt: new Date().toISOString(),
          },
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    this.trafficCache = { expiresAt: Date.now() + 15_000, value: relationships };
    return relationships;
  }

  private async detectMetricsApi(): Promise<boolean> {
    try {
      const api = this.kubeConfig.makeApiClient(CustomObjectsApi);
      await api.listClusterCustomObject({
        group: 'metrics.k8s.io',
        version: 'v1beta1',
        plural: 'nodes',
        limit: 1,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async detectPrometheus(): Promise<PrometheusTarget | undefined> {
    try {
      const api = this.kubeConfig.makeApiClient(CoreV1Api);
      const services = (await api.listServiceForAllNamespaces()).items
        .filter(isPrometheusServerService)
        .sort((left, right) => prometheusServiceScore(right) - prometheusServiceScore(left));
      for (const service of services.slice(0, 4)) {
        const name = service.metadata?.name;
        const namespace = service.metadata?.namespace;
        const port =
          service.spec?.ports?.find((item) => item.port === 9090)?.port ??
          service.spec?.ports?.find((item) => /http-web|web|http/i.test(item.name ?? ''))?.port;
        if (!name || !namespace || !port || !isDnsLabel(name) || !isDnsLabel(namespace)) continue;
        const target = {
          id: `prometheus:${namespace}:${name}`,
          name,
          namespace,
          url: `http://${name}.${namespace}.svc:${port}`,
        };
        const response = await this.query(target, 'up');
        if (response.status === 'success') return target;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private async hasIstioTrafficMetrics(target: PrometheusTarget): Promise<boolean> {
    const response = await this.query(target, 'count(istio_requests_total)');
    return (response.data?.result?.length ?? 0) > 0 && firstValue(response) !== undefined;
  }

  private async query(target: PrometheusTarget, query: string): Promise<PrometheusResponse> {
    try {
      const url = new URL('/api/v1/query', target.url);
      url.searchParams.set('query', query);
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) return { status: 'error' };
      return (await response.json()) as PrometheusResponse;
    } catch {
      return { status: 'error' };
    }
  }
}

export function isPrometheusServerService(service: V1Service): boolean {
  const name = service.metadata?.name?.toLocaleLowerCase() ?? '';
  const labels = service.metadata?.labels ?? {};
  const applicationName = labels['app.kubernetes.io/name']?.toLocaleLowerCase() ?? '';
  const selectorName =
    service.spec?.selector?.['app.kubernetes.io/name']?.toLocaleLowerCase() ?? '';
  if (name.includes('operator') || name.includes('node-exporter') || name.includes('alertmanager'))
    return false;
  return (
    applicationName === 'prometheus' ||
    selectorName === 'prometheus' ||
    name.endsWith('-prometheus') ||
    name === 'prometheus-operated'
  );
}

function prometheusServiceScore(service: V1Service): number {
  const name = service.metadata?.name?.toLocaleLowerCase() ?? '';
  let score = service.spec?.clusterIP && service.spec.clusterIP !== 'None' ? 20 : 0;
  if (service.spec?.ports?.some((item) => item.port === 9090)) score += 20;
  if (service.metadata?.labels?.['app.kubernetes.io/name'] === 'prometheus') score += 15;
  if (name.endsWith('-prometheus')) score += 10;
  if (name === 'prometheus-operated') score -= 10;
  return score;
}

function firstValue(response: PrometheusResponse): number | undefined {
  const result = response.data?.result?.[0];
  return result ? vectorValue(result) : undefined;
}

function vectorValue(result: PrometheusVector): number | undefined {
  const value = Number(result.value?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

function escapePrometheusString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function escapePrometheusRegex(value: string): string {
  return escapePrometheusString(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDnsLabel(value: string): boolean {
  return /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value);
}
