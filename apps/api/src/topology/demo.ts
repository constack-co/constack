import type { Resource, TopologySnapshot } from '@constack/shared-types';
import { SCHEMA_VERSION } from '@constack/shared-types';
import { buildRelationships, deterministicLayout } from '@constack/topology-engine';

const now = new Date().toISOString();
const make = (
  id: string,
  kind: Resource['kind'],
  name: string,
  namespace: string | undefined,
  properties: Record<string, unknown> = {},
  ownerUids: string[] = [],
): Resource => ({
  id,
  logicalId: `${kind}:${namespace ?? ''}:${name}`,
  clusterId: 'in-cluster',
  uid: id,
  apiVersion: kind === 'Deployment' ? 'apps/v1' : 'v1',
  kind,
  name,
  ...(namespace ? { namespace } : {}),
  resourceVersion: '1',
  createdAt: now,
  observedAt: now,
  status: kind === 'Deployment' ? '3/3 ready' : 'Ready',
  health: 'healthy',
  labels: namespace ? { 'app.kubernetes.io/name': 'checkout' } : {},
  annotations: {},
  ownerUids,
  images: kind === 'Pod' ? ['ghcr.io/example/checkout:1.4.0'] : [],
  conditions: [],
  metrics: {},
  properties,
});

export function createDemoSnapshot(): TopologySnapshot {
  const resources = [
    make('cluster', 'Cluster', 'local-cluster', undefined),
    make('node-a', 'Node', 'worker-a', undefined),
    make('namespace', 'Namespace', 'production', undefined),
    make('deployment', 'Deployment', 'checkout', 'production', {
      desiredReplicas: 3,
      readyReplicas: 3,
    }),
    make('replicaset', 'ReplicaSet', 'checkout-7d8', 'production', {}, ['deployment']),
    make(
      'pod-a',
      'Pod',
      'checkout-7d8-a',
      'production',
      { nodeName: 'worker-a', restartCount: 0 },
      ['replicaset'],
    ),
    make(
      'pod-b',
      'Pod',
      'checkout-7d8-b',
      'production',
      { nodeName: 'worker-a', restartCount: 0 },
      ['replicaset'],
    ),
    make(
      'pod-c',
      'Pod',
      'checkout-7d8-c',
      'production',
      { nodeName: 'worker-a', restartCount: 0 },
      ['replicaset'],
    ),
    make('service', 'Service', 'checkout', 'production', {
      endpointTargetUids: ['pod-a', 'pod-b', 'pod-c'],
    }),
    make('ingress', 'Ingress', 'checkout', 'production', { serviceNames: ['checkout'] }),
    make('claim', 'PersistentVolumeClaim', 'checkout-data', 'production', {
      volumeName: 'checkout-pv',
    }),
    make('volume', 'PersistentVolume', 'checkout-pv', undefined),
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    clusterId: 'in-cluster',
    sequence: 1,
    generatedAt: now,
    occurredAt: now,
    resources,
    relationships: buildRelationships(resources),
    positions: deterministicLayout(resources),
  };
}
