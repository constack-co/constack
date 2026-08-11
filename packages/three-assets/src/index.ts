import type { HealthState, Resource, ResourceKind } from '@constack/shared-types';

export type FallbackGeometry = 'sphere' | 'box' | 'cylinder' | 'cone' | 'octahedron' | 'torus';

export interface AssetDefinition {
  modelPath: string;
  scale: readonly [number, number, number];
  rotation: readonly [number, number, number];
  positionOffset: readonly [number, number, number];
  labelOffset: readonly [number, number, number];
  animation: { type: 'none' | 'pulse' | 'rotate'; speed: number };
  healthMaterials: Record<HealthState, string>;
  lod: { near: number; medium: number; far: number };
  fallback: FallbackGeometry;
}

const colors: Record<HealthState, string> = {
  healthy: '#34d399',
  progressing: '#38bdf8',
  degraded: '#f59e0b',
  unhealthy: '#fb7185',
  unknown: '#64748b',
};

const fallbackByKind: Partial<Record<ResourceKind, FallbackGeometry>> = {
  Cluster: 'sphere',
  Node: 'box',
  Namespace: 'cylinder',
  Deployment: 'octahedron',
  ReplicaSet: 'octahedron',
  StatefulSet: 'cylinder',
  DaemonSet: 'torus',
  Pod: 'sphere',
  Service: 'cylinder',
  Ingress: 'cone',
  Database: 'cylinder',
  Cache: 'box',
  Queue: 'torus',
  PersistentVolume: 'box',
  PersistentVolumeClaim: 'box',
  ExternalAPI: 'cone',
};

const modelNameByKind: Partial<Record<ResourceKind, string>> = {
  Deployment: 'deploy',
};

export const assetRegistry: Record<ResourceKind, AssetDefinition> = Object.fromEntries(
  [
    'Cluster',
    'Node',
    'Namespace',
    'Deployment',
    'ReplicaSet',
    'StatefulSet',
    'DaemonSet',
    'Pod',
    'Service',
    'Endpoints',
    'EndpointSlice',
    'Ingress',
    'Job',
    'CronJob',
    'PersistentVolume',
    'PersistentVolumeClaim',
    'StorageClass',
    'ConfigMap',
    'Secret',
    'NetworkPolicy',
    'HorizontalPodAutoscaler',
    'ServiceAccount',
    'Event',
    'Database',
    'Queue',
    'Cache',
    'ExternalAPI',
  ].map((kind): [ResourceKind, AssetDefinition] => [
    kind as ResourceKind,
    {
      modelPath: `/models/${modelNameByKind[kind as ResourceKind] ?? kind.toLocaleLowerCase()}-3d.glb`,
      scale: [1, 1, 1],
      rotation: [0, 0, 0],
      positionOffset: [0, 0, 0],
      labelOffset: [0, 1.6, 0],
      animation: { type: kind === 'Queue' ? 'rotate' : 'none', speed: 0.2 },
      healthMaterials: colors,
      lod: { near: 35, medium: 90, far: 180 },
      fallback: fallbackByKind[kind as ResourceKind] ?? 'box',
    },
  ]),
) as Record<ResourceKind, AssetDefinition>;

export function assetFor(kind: ResourceKind): AssetDefinition {
  return assetRegistry[kind]!;
}

const redisAsset: AssetDefinition = {
  ...assetRegistry.Cache,
  modelPath: '/models/redis-3d.glb',
};

export function assetForResource(resource: Pick<Resource, 'kind' | 'images'>): AssetDefinition {
  return resource.images.some(isRedisImage) ? redisAsset : assetFor(resource.kind);
}

function isRedisImage(image: string): boolean {
  const withoutDigest = image.toLocaleLowerCase().split('@', 1)[0]!;
  const repository = withoutDigest.split('/').at(-1)!.split(':', 1)[0]!;
  return (
    repository === 'redis' || repository === 'redis-stack' || repository === 'redis-stack-server'
  );
}
