import { describe, expect, it } from 'vitest';
import { resourceSchema } from './index.js';

describe('shared security contracts', () => {
  it('keeps normalized resources free of raw Kubernetes objects', () => {
    const result = resourceSchema.safeParse({
      id: 'cluster:pod:uid',
      logicalId: 'Pod:default:web',
      clusterId: 'cluster',
      uid: 'uid',
      apiVersion: 'v1',
      kind: 'Pod',
      name: 'web',
      namespace: 'default',
      observedAt: new Date().toISOString(),
      status: 'Running',
      health: 'healthy',
      labels: {},
      annotations: {},
      ownerUids: [],
      images: [],
      conditions: [],
      metrics: {},
      properties: {},
      data: { password: 'must never fit the contract' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect('data' in result.data).toBe(false);
  });
});
