import { describe, expect, it } from 'vitest';
import type { Resource } from '@constack/shared-types';
import { getAttentionItems } from './attention';

const resource = (
  partial: Partial<Resource> & Pick<Resource, 'id' | 'uid' | 'kind' | 'name'>,
): Resource => ({
  clusterId: 'local',
  apiVersion: 'v1',
  logicalId: `${partial.kind}:demo:${partial.name}`,
  namespace: 'demo',
  observedAt: '2026-01-01T00:00:00.000Z',
  status: 'Observed',
  health: 'healthy',
  labels: {},
  annotations: {},
  ownerUids: [],
  images: [],
  conditions: [],
  metrics: {},
  properties: {},
  ...partial,
});

describe('attention items', () => {
  it('includes a zero-ready rollout even while Kubernetes calls it progressing', () => {
    const deployment = resource({
      id: 'd',
      uid: 'd',
      kind: 'Deployment',
      name: 'storefront',
      health: 'progressing',
      properties: { desiredReplicas: 2, readyReplicas: 0 },
    });
    expect(getAttentionItems([deployment])).toMatchObject([
      { severity: 'critical', reason: '0 of 2 replicas ready' },
    ]);
  });

  it('includes image pull failures and ignores healthy ReplicaSets', () => {
    const pod = resource({
      id: 'p',
      uid: 'p',
      kind: 'Pod',
      name: 'storefront-1',
      status: 'ImagePullBackOff',
      health: 'unhealthy',
      properties: { containerStatuses: [{ name: 'storefront', reason: 'ImagePullBackOff' }] },
    });
    const replicaSet = resource({
      id: 'r',
      uid: 'r',
      kind: 'ReplicaSet',
      name: 'storefront-rs',
      health: 'degraded',
    });
    expect(getAttentionItems([pod, replicaSet]).map((item) => item.resource.id)).toEqual(['p']);
  });
});
