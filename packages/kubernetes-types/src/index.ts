import type { HealthState, Resource, ResourceKind } from '@constack/shared-types';

export interface KubernetesObject {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    uid?: string;
    name?: string;
    namespace?: string;
    resourceVersion?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: Array<{ uid?: string }>;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WatchDescriptor {
  readonly kind: ResourceKind;
  readonly apiVersion: string;
  readonly path: string;
  readonly optionalFeature?: 'secretMetadata';
}

export const WATCH_DESCRIPTORS: ReadonlyArray<WatchDescriptor> = [
  { kind: 'Node', apiVersion: 'v1', path: '/api/v1/nodes' },
  { kind: 'Namespace', apiVersion: 'v1', path: '/api/v1/namespaces' },
  { kind: 'Pod', apiVersion: 'v1', path: '/api/v1/pods' },
  { kind: 'Service', apiVersion: 'v1', path: '/api/v1/services' },
  { kind: 'Endpoints', apiVersion: 'v1', path: '/api/v1/endpoints' },
  { kind: 'PersistentVolume', apiVersion: 'v1', path: '/api/v1/persistentvolumes' },
  { kind: 'PersistentVolumeClaim', apiVersion: 'v1', path: '/api/v1/persistentvolumeclaims' },
  { kind: 'ConfigMap', apiVersion: 'v1', path: '/api/v1/configmaps' },
  { kind: 'Secret', apiVersion: 'v1', path: '/api/v1/secrets', optionalFeature: 'secretMetadata' },
  { kind: 'ServiceAccount', apiVersion: 'v1', path: '/api/v1/serviceaccounts' },
  { kind: 'Event', apiVersion: 'v1', path: '/api/v1/events' },
  { kind: 'Deployment', apiVersion: 'apps/v1', path: '/apis/apps/v1/deployments' },
  { kind: 'ReplicaSet', apiVersion: 'apps/v1', path: '/apis/apps/v1/replicasets' },
  { kind: 'StatefulSet', apiVersion: 'apps/v1', path: '/apis/apps/v1/statefulsets' },
  { kind: 'DaemonSet', apiVersion: 'apps/v1', path: '/apis/apps/v1/daemonsets' },
  {
    kind: 'Ingress',
    apiVersion: 'networking.k8s.io/v1',
    path: '/apis/networking.k8s.io/v1/ingresses',
  },
  {
    kind: 'NetworkPolicy',
    apiVersion: 'networking.k8s.io/v1',
    path: '/apis/networking.k8s.io/v1/networkpolicies',
  },
  { kind: 'Job', apiVersion: 'batch/v1', path: '/apis/batch/v1/jobs' },
  { kind: 'CronJob', apiVersion: 'batch/v1', path: '/apis/batch/v1/cronjobs' },
  {
    kind: 'StorageClass',
    apiVersion: 'storage.k8s.io/v1',
    path: '/apis/storage.k8s.io/v1/storageclasses',
  },
  {
    kind: 'EndpointSlice',
    apiVersion: 'discovery.k8s.io/v1',
    path: '/apis/discovery.k8s.io/v1/endpointslices',
  },
  {
    kind: 'HorizontalPodAutoscaler',
    apiVersion: 'autoscaling/v2',
    path: '/apis/autoscaling/v2/horizontalpodautoscalers',
  },
];

export function normalizeKubernetesObject(
  clusterId: string,
  input: KubernetesObject,
  observedAt = new Date().toISOString(),
): Resource | undefined {
  const kind = input.kind as ResourceKind | undefined;
  const metadata = input.metadata;
  if (!kind || !metadata?.uid || !metadata.name || !input.apiVersion) return undefined;

  const namespace = metadata.namespace;
  const podSpec = findPodSpec(input);
  const containers = asArray<Record<string, unknown>>(podSpec?.containers);
  const initContainers = asArray<Record<string, unknown>>(podSpec?.initContainers);
  const allContainers = [...containers, ...initContainers];
  const configMapRefs = new Set<string>();
  const secretRefs = new Set<string>();
  for (const container of allContainers) {
    for (const env of asArray<Record<string, unknown>>(container.env)) {
      const valueFrom = asRecord(env.valueFrom);
      collectNamedRef(valueFrom?.configMapKeyRef, configMapRefs);
      collectNamedRef(valueFrom?.secretKeyRef, secretRefs);
    }
    for (const envFrom of asArray<Record<string, unknown>>(container.envFrom)) {
      collectNamedRef(envFrom.configMapRef, configMapRefs);
      collectNamedRef(envFrom.secretRef, secretRefs);
    }
  }
  const claims = new Set<string>();
  for (const volume of asArray<Record<string, unknown>>(podSpec?.volumes)) {
    collectNamedRef(volume.persistentVolumeClaim, claims, 'claimName');
    collectNamedRef(volume.configMap, configMapRefs);
    collectNamedRef(volume.secret, secretRefs, 'secretName');
    const projected = asRecord(volume.projected);
    for (const source of asArray<Record<string, unknown>>(projected?.sources)) {
      collectNamedRef(source.configMap, configMapRefs);
      collectNamedRef(source.secret, secretRefs);
    }
  }

  const properties: Record<string, unknown> = {
    nodeName: stringValue(podSpec?.nodeName),
    serviceAccountName: stringValue(podSpec?.serviceAccountName),
    containerResources: allContainers.map((container) => {
      const resources = asRecord(container.resources);
      return {
        name: stringValue(container.name) ?? 'unnamed',
        requests: stringRecord(resources?.requests),
        limits: stringRecord(resources?.limits),
        hasLivenessProbe: Boolean(container.livenessProbe),
        hasReadinessProbe: Boolean(container.readinessProbe),
        hasStartupProbe: Boolean(container.startupProbe),
      };
    }),
    configMapRefs: [...configMapRefs],
    secretRefs: [...secretRefs],
    persistentVolumeClaims: [...claims],
  };
  Object.assign(properties, kindProperties(kind, input));
  removeUndefined(properties);

  const status = summarizeStatus(kind, input);
  return {
    id: Buffer.from(`${clusterId}:${metadata.uid}`).toString('base64url'),
    logicalId: `${kind}:${namespace ?? ''}:${metadata.name}`,
    clusterId,
    uid: metadata.uid,
    apiVersion: input.apiVersion,
    kind,
    name: metadata.name,
    ...(namespace ? { namespace } : {}),
    ...(metadata.resourceVersion ? { resourceVersion: metadata.resourceVersion } : {}),
    ...(metadata.creationTimestamp ? { createdAt: metadata.creationTimestamp } : {}),
    observedAt,
    status: status.text,
    health: status.health,
    labels: sanitizeMap(metadata.labels, kind === 'Secret'),
    annotations: sanitizeAnnotations(metadata.annotations, kind === 'Secret'),
    ownerUids: (metadata.ownerReferences ?? [])
      .map((owner) => owner.uid)
      .filter((uid): uid is string => Boolean(uid)),
    images: allContainers
      .map((container) => container.image)
      .filter((image): image is string => typeof image === 'string'),
    conditions: asArray<Record<string, unknown>>(input.status?.conditions).map((condition) => ({
      type: String(condition.type ?? 'Unknown'),
      status: String(condition.status ?? 'Unknown'),
      ...(typeof condition.reason === 'string' ? { reason: condition.reason } : {}),
      ...(typeof condition.message === 'string'
        ? { message: condition.message.slice(0, 2_000) }
        : {}),
      ...(typeof condition.lastTransitionTime === 'string'
        ? { lastTransitionTime: condition.lastTransitionTime }
        : {}),
    })),
    metrics: {},
    properties,
  };
}

function kindProperties(kind: ResourceKind, input: KubernetesObject): Record<string, unknown> {
  const spec = input.spec ?? {};
  const status = input.status ?? {};
  switch (kind) {
    case 'Pod':
      return {
        restartCount: [
          ...asArray<Record<string, unknown>>(status.containerStatuses),
          ...asArray<Record<string, unknown>>(status.initContainerStatuses),
        ].reduce((total, item) => total + numberValue(item.restartCount), 0),
        containerStatuses: [
          ...asArray<Record<string, unknown>>(status.initContainerStatuses),
          ...asArray<Record<string, unknown>>(status.containerStatuses),
        ].map(containerStatusProjection),
        podIP: stringValue(status.podIP),
        qosClass: stringValue(status.qosClass),
      };
    case 'Service':
      return {
        serviceType: stringValue(spec.type),
        clusterIP: stringValue(spec.clusterIP),
        selector: stringRecord(spec.selector),
      };
    case 'EndpointSlice':
      return {
        endpointTargetUids: asArray<Record<string, unknown>>(input.endpoints).flatMap((endpoint) =>
          typeof asRecord(endpoint.targetRef)?.uid === 'string'
            ? [asRecord(endpoint.targetRef)!.uid as string]
            : [],
        ),
        serviceNames: input.metadata?.labels?.['kubernetes.io/service-name']
          ? [input.metadata.labels['kubernetes.io/service-name']]
          : [],
      };
    case 'Endpoints':
      return {
        endpointTargetUids: asArray<Record<string, unknown>>(input.subsets).flatMap((subset) =>
          [
            ...asArray<Record<string, unknown>>(subset.addresses),
            ...asArray<Record<string, unknown>>(subset.notReadyAddresses),
          ]
            .map((address) => asRecord(address.targetRef)?.uid)
            .filter((uid): uid is string => typeof uid === 'string'),
        ),
      };
    case 'Ingress':
      return {
        serviceNames: [
          ...asArray<Record<string, unknown>>(spec.rules).flatMap((rule) => {
            const http = asRecord(rule.http);
            return asArray<Record<string, unknown>>(http?.paths)
              .map((path) => asRecord(asRecord(path.backend)?.service)?.name)
              .filter((name): name is string => typeof name === 'string');
          }),
          ...(() => {
            const defaultName = asRecord(asRecord(spec.defaultBackend)?.service)?.name;
            return typeof defaultName === 'string' ? [defaultName] : [];
          })(),
        ],
      };
    case 'PersistentVolumeClaim':
      return {
        volumeName: stringValue(spec.volumeName),
        storageClassName: stringValue(spec.storageClassName),
      };
    case 'HorizontalPodAutoscaler': {
      const target = asRecord(spec.scaleTargetRef);
      return target
        ? { scaleTarget: { kind: String(target.kind ?? ''), name: String(target.name ?? '') } }
        : {};
    }
    case 'NetworkPolicy':
      return { podSelector: stringRecord(asRecord(spec.podSelector)?.matchLabels) };
    case 'Event': {
      const involved = asRecord(input.involvedObject);
      return {
        involvedObjectUid: stringValue(involved?.uid),
        reason: stringValue(input.reason),
        eventType: stringValue(input.type),
        message: typeof input.message === 'string' ? input.message.slice(0, 2_000) : undefined,
      };
    }
    case 'Deployment':
    case 'StatefulSet':
    case 'ReplicaSet':
      return {
        desiredReplicas: numberValue(spec.replicas),
        readyReplicas: numberValue(status.readyReplicas),
        availableReplicas: numberValue(status.availableReplicas),
        updatedReplicas: numberValue(status.updatedReplicas),
        unavailableReplicas: numberValue(status.unavailableReplicas),
      };
    case 'DaemonSet':
      return {
        desiredReplicas: numberValue(status.desiredNumberScheduled),
        readyReplicas: numberValue(status.numberReady),
        availableReplicas: numberValue(status.numberAvailable),
        updatedReplicas: numberValue(status.updatedNumberScheduled),
        unavailableReplicas: numberValue(status.numberUnavailable),
      };
    default:
      return {};
  }
}

function summarizeStatus(
  kind: ResourceKind,
  input: KubernetesObject,
): { text: string; health: HealthState } {
  const status = input.status ?? {};
  const conditions = asArray<Record<string, unknown>>(status.conditions);
  if (kind === 'Pod') {
    const phase = String(status.phase ?? 'Unknown');
    const containerStatuses = [
      ...asArray<Record<string, unknown>>(status.initContainerStatuses),
      ...asArray<Record<string, unknown>>(status.containerStatuses),
    ];
    const blockingReason = containerStatuses
      .map((item) => stringValue(asRecord(asRecord(item.state)?.waiting)?.reason))
      .find((reason) => reason && isActionableContainerReason(reason));
    if (blockingReason) return { text: blockingReason, health: 'unhealthy' };
    if (phase === 'Running' || phase === 'Succeeded') return { text: phase, health: 'healthy' };
    if (phase === 'Pending') return { text: phase, health: 'progressing' };
    if (phase === 'Failed') return { text: phase, health: 'unhealthy' };
    return { text: phase, health: 'unknown' };
  }
  if (kind === 'Node') {
    const ready = conditions.find((condition) => condition.type === 'Ready');
    if (ready?.status === 'True') return { text: 'Ready', health: 'healthy' };
    if (ready?.status === 'False')
      return { text: String(ready.reason ?? 'NotReady'), health: 'unhealthy' };
    return { text: 'Unknown', health: 'unknown' };
  }
  if (
    kind === 'Deployment' ||
    kind === 'StatefulSet' ||
    kind === 'DaemonSet' ||
    kind === 'ReplicaSet'
  ) {
    const desired =
      kind === 'DaemonSet'
        ? numberValue(status.desiredNumberScheduled)
        : numberValue(input.spec?.replicas);
    const ready = numberValue(status.readyReplicas ?? status.numberReady);
    if (desired === 0 || ready >= desired)
      return { text: `${ready}/${desired} ready`, health: 'healthy' };
    if (ready > 0) return { text: `${ready}/${desired} ready`, health: 'degraded' };
    return { text: `${ready}/${desired} ready`, health: 'progressing' };
  }
  if (kind === 'Job') {
    if (numberValue(status.failed) > 0) return { text: 'Failed', health: 'unhealthy' };
    if (numberValue(status.succeeded) > 0) return { text: 'Succeeded', health: 'healthy' };
    return { text: 'Running', health: 'progressing' };
  }
  if (kind === 'PersistentVolumeClaim') {
    const phase = String(status.phase ?? 'Pending');
    return { text: phase, health: phase === 'Bound' ? 'healthy' : 'degraded' };
  }
  const negative = conditions.find(
    (condition) =>
      condition.status === 'False' &&
      ['Ready', 'Available', 'Healthy'].includes(String(condition.type)),
  );
  if (negative) return { text: String(negative.reason ?? negative.type), health: 'degraded' };
  return { text: String(status.phase ?? 'Observed'), health: 'healthy' };
}

function containerStatusProjection(item: Record<string, unknown>): Record<string, unknown> {
  const state = asRecord(item.state);
  const waiting = asRecord(state?.waiting);
  const running = asRecord(state?.running);
  const terminated = asRecord(state?.terminated);
  const lastTerminated = asRecord(asRecord(item.lastState)?.terminated);
  const stateName = waiting
    ? 'waiting'
    : running
      ? 'running'
      : terminated
        ? 'terminated'
        : 'unknown';
  const projection: Record<string, unknown> = {
    name: stringValue(item.name) ?? 'unnamed',
    ready: item.ready === true,
    restartCount: numberValue(item.restartCount),
    state: stateName,
    reason: stringValue(waiting?.reason) ?? stringValue(terminated?.reason),
    exitCode: numberOrUndefined(terminated?.exitCode),
    lastTerminationReason: stringValue(lastTerminated?.reason),
    lastTerminationAt: stringValue(lastTerminated?.finishedAt),
  };
  removeUndefined(projection);
  return projection;
}

function isActionableContainerReason(reason: string): boolean {
  return [
    'CrashLoopBackOff',
    'ImagePullBackOff',
    'ErrImagePull',
    'CreateContainerConfigError',
    'CreateContainerError',
    'RunContainerError',
  ].includes(reason);
}

function findPodSpec(input: KubernetesObject): Record<string, unknown> | undefined {
  if (input.kind === 'Pod') return input.spec;
  const template = asRecord(input.spec?.template);
  return asRecord(template?.spec);
}

function sanitizeMap(
  input: Record<string, string> | undefined,
  secret: boolean,
): Record<string, string> {
  if (!input) return {};
  if (secret) {
    return Object.fromEntries(
      Object.entries(input).filter(
        ([key]) => key.startsWith('app.kubernetes.io/') || key === 'kubernetes.io/metadata.name',
      ),
    );
  }
  return Object.fromEntries(
    Object.entries(input)
      .slice(0, 100)
      .map(([key, value]) => [key, value.slice(0, 500)]),
  );
}

function sanitizeAnnotations(
  input: Record<string, string> | undefined,
  secret: boolean,
): Record<string, string> {
  if (!input || secret) return {};
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => key !== 'kubectl.kubernetes.io/last-applied-configuration')
      .slice(0, 100)
      .map(([key, value]) => [key, value.slice(0, 1_000)]),
  );
}

function collectNamedRef(value: unknown, target: Set<string>, field = 'name'): void {
  const record = asRecord(value);
  const name = record?.[field];
  if (typeof name === 'string') target.add(name);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray<T extends Record<string, unknown>>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is T => typeof item === 'object' && item !== null);
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function removeUndefined(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) if (record[key] === undefined) delete record[key];
}
