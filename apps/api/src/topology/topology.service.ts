import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { loadRuntimeConfig } from '@constack/config';
import {
  topologySnapshotSchema,
  type Resource,
  type TopologySnapshot,
} from '@constack/shared-types';
import {
  deterministicLayout,
  evaluateDiagnostics,
  type LayoutMode,
} from '@constack/topology-engine';
import { RedisService } from '../common/redis.service.js';
import { createDemoSnapshot } from './demo.js';
import { CoreV1Api, CustomObjectsApi, KubeConfig } from '@kubernetes/client-node';
import { TelemetryService } from './telemetry.service.js';

@Injectable()
export class TopologyService {
  private readonly config = loadRuntimeConfig();
  private readonly kubeConfig = new KubeConfig();

  constructor(
    private readonly redis: RedisService,
    private readonly telemetry: TelemetryService,
  ) {
    try {
      this.kubeConfig.loadFromDefault();
    } catch {
      // Resource/log endpoints report an unavailable state when no Kubernetes config exists.
    }
  }

  async snapshot(mode: LayoutMode = 'cluster'): Promise<TopologySnapshot> {
    const raw = await this.redis.client.get(`constack:topology:${this.config.CLUSTER_ID}:snapshot`);
    const snapshot = raw
      ? topologySnapshotSchema.parse(JSON.parse(raw))
      : this.config.DEMO_MODE
        ? createDemoSnapshot()
        : {
            ...createDemoSnapshot(),
            resources: [],
            relationships: [],
            positions: {},
            sequence: 0,
          };
    const observedTraffic = await this.telemetry.trafficRelationships(snapshot.resources);
    const relationships = new Map(
      snapshot.relationships.map((relationship) => [relationship.id, relationship]),
    );
    for (const relationship of observedTraffic) relationships.set(relationship.id, relationship);
    return {
      ...snapshot,
      relationships: [...relationships.values()],
      positions: deterministicLayout(snapshot.resources, mode),
    };
  }

  async resources(search?: string, namespace?: string, kind?: string): Promise<Resource[]> {
    const snapshot = await this.snapshot();
    const needle = search?.toLocaleLowerCase();
    return snapshot.resources.filter(
      (resource) =>
        (!needle ||
          `${resource.kind} ${resource.namespace ?? ''} ${resource.name}`
            .toLocaleLowerCase()
            .includes(needle)) &&
        (!namespace || resource.namespace === namespace) &&
        (!kind || resource.kind === kind),
    );
  }

  async resource(resourceId: string): Promise<Resource> {
    const resource = (await this.snapshot()).resources.find((item) => item.id === resourceId);
    if (!resource) throw new NotFoundException('Resource not found');
    return resource;
  }

  async detail(resourceId: string) {
    const snapshot = await this.snapshot();
    const resource = snapshot.resources.find((item) => item.id === resourceId);
    if (!resource) throw new NotFoundException('Resource not found');
    const relationshipIds = snapshot.relationships
      .filter((edge) => edge.source === resourceId || edge.target === resourceId)
      .flatMap((edge) => [edge.source, edge.target]);
    const affectedIds = new Set([resourceId]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const edge of snapshot.relationships) {
        if (
          (edge.type === 'owns' || edge.type === 'routes-to') &&
          affectedIds.has(edge.source) &&
          !affectedIds.has(edge.target)
        ) {
          affectedIds.add(edge.target);
          expanded = true;
        }
      }
    }
    const affectedUids = new Set(
      snapshot.resources.filter((item) => affectedIds.has(item.id)).map((item) => item.uid),
    );
    const events = snapshot.resources.filter(
      (item) =>
        item.kind === 'Event' &&
        typeof item.properties.involvedObjectUid === 'string' &&
        affectedUids.has(item.properties.involvedObjectUid),
    );
    return {
      resource,
      relationships: snapshot.relationships.filter(
        (edge) => edge.source === resourceId || edge.target === resourceId,
      ),
      relatedResources: snapshot.resources.filter(
        (item) => relationshipIds.includes(item.id) && item.id !== resourceId,
      ),
      diagnostics: evaluateDiagnostics(resource, events),
      events,
    };
  }

  async logs(resourceId: string, container?: string, tailLines = 200) {
    const resource = await this.resource(resourceId);
    if (resource.kind !== 'Pod' || !resource.namespace)
      throw new NotFoundException('Logs are available for namespaced Pods only');
    try {
      const api = this.kubeConfig.makeApiClient(CoreV1Api);
      const result = await api.readNamespacedPodLog({
        name: resource.name,
        namespace: resource.namespace,
        ...(container ? { container } : {}),
        tailLines: Math.min(2_000, Math.max(1, tailLines)),
        timestamps: true,
      });
      return { available: true, lines: String(result).split('\n') };
    } catch (error) {
      throw new ServiceUnavailableException(
        `Kubernetes logs unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  async metrics(resourceId: string) {
    const resource = await this.resource(resourceId);
    if (!this.config.METRICS_ENABLED)
      return { available: false, reason: 'Telemetry collection is disabled by the administrator.' };
    if (resource.namespace && resource.kind === 'Pod') {
      try {
        const api = this.kubeConfig.makeApiClient(CustomObjectsApi);
        const result = await api.getNamespacedCustomObject({
          group: 'metrics.k8s.io',
          version: 'v1beta1',
          namespace: resource.namespace,
          plural: 'pods',
          name: resource.name,
        });
        return { available: true, provider: 'Kubernetes Metrics API', data: result };
      } catch {
        // Fall through to an auto-detected Prometheus-compatible provider.
      }
    }
    const prometheus = await this.telemetry.prometheusMetrics(resource);
    if (prometheus)
      return { available: true, provider: String(prometheus.provider), data: prometheus };
    return { available: false, reason: 'No compatible metrics source supports this resource.' };
  }

  telemetryCapabilities() {
    return this.telemetry.capabilities();
  }
}
