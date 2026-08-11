import type { Resource, ResourceKind } from '@constack/shared-types';

export type TopologyLayer =
  | 'workloads'
  | 'replicas'
  | 'nodes'
  | 'storage'
  | 'configuration'
  | 'security'
  | 'traffic';

export const defaultTopologyLayers: ReadonlyArray<TopologyLayer> = ['workloads', 'replicas'];

const workloadKinds = new Set<ResourceKind>([
  'Ingress',
  'Service',
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'Job',
  'CronJob',
  'Database',
  'Queue',
  'Cache',
  'ExternalAPI',
]);

const replicaKinds = new Set<ResourceKind>(['ReplicaSet', 'Pod']);
const nodeKinds = new Set<ResourceKind>(['Cluster', 'Node', 'Namespace']);
const storageKinds = new Set<ResourceKind>([
  'PersistentVolume',
  'PersistentVolumeClaim',
  'StorageClass',
]);
const configurationKinds = new Set<ResourceKind>([
  'Endpoints',
  'EndpointSlice',
  'ConfigMap',
  'Secret',
  'HorizontalPodAutoscaler',
  'ServiceAccount',
]);
const securityKinds = new Set<ResourceKind>(['NetworkPolicy']);

export function topologyLayerForResource(
  resource: Resource,
): Exclude<TopologyLayer, 'traffic'> | undefined {
  if (workloadKinds.has(resource.kind)) return 'workloads';
  if (replicaKinds.has(resource.kind)) return 'replicas';
  if (nodeKinds.has(resource.kind)) return 'nodes';
  if (storageKinds.has(resource.kind)) return 'storage';
  if (configurationKinds.has(resource.kind)) return 'configuration';
  if (securityKinds.has(resource.kind)) return 'security';
  return undefined;
}

export function isTopologyResourceVisible(
  resource: Resource,
  layers: ReadonlyArray<TopologyLayer>,
  search = '',
  namespace?: string,
  visibleKinds: ReadonlyArray<string> = [],
): boolean {
  const layer = topologyLayerForResource(resource);
  if (!layer || !layers.includes(layer)) return false;
  if (namespace && resource.namespace !== namespace) return false;
  if (visibleKinds.length && !visibleKinds.includes(resource.kind)) return false;
  return (
    !search ||
    `${resource.kind} ${resource.name} ${resource.namespace ?? ''} ${resource.health} ${resource.status}`
      .toLocaleLowerCase()
      .includes(search)
  );
}
