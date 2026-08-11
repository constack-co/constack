import { describe, expect, it } from 'vitest';
import type { Resource } from '@constack/shared-types';
import { buildRelationships, deterministicLayout, evaluateDiagnostics } from './index.js';

const observedAt = '2026-01-01T00:00:00.000Z';
const resource = (
  partial: Partial<Resource> & Pick<Resource, 'id' | 'uid' | 'kind' | 'name'>,
): Resource => ({
  clusterId: 'local',
  apiVersion: 'v1',
  logicalId: `${partial.kind}:default:${partial.name}`,
  namespace: partial.kind === 'Node' ? undefined : 'default',
  observedAt,
  status: 'Ready',
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

describe('topology engine', () => {
  it('produces stable positions independent of input ordering', () => {
    const a = resource({ id: 'a', uid: 'a', kind: 'Pod', name: 'a' });
    const b = resource({ id: 'b', uid: 'b', kind: 'Pod', name: 'b' });
    expect(deterministicLayout([a, b])).toEqual(deterministicLayout([b, a]));
  });

  it('connects owners and scheduled pods', () => {
    const node = resource({
      id: 'node',
      uid: 'node',
      kind: 'Node',
      name: 'worker',
      namespace: undefined,
    });
    const owner = resource({
      id: 'deployment',
      uid: 'deployment',
      kind: 'Deployment',
      name: 'web',
    });
    const pod = resource({
      id: 'pod',
      uid: 'pod',
      kind: 'Pod',
      name: 'web-1',
      ownerUids: ['deployment'],
      properties: { nodeName: 'worker' },
    });
    const types = buildRelationships([node, owner, pod]).map((edge) => edge.type);
    expect(types).toContain('owns');
    expect(types).toContain('scheduled-on');
  });

  it('lays out ten thousand resources within the worker performance budget', () => {
    const resources = Array.from({ length: 10_000 }, (_, index) =>
      resource({
        id: `pod-${index}`,
        uid: `pod-${index}`,
        kind: 'Pod',
        name: `pod-${index}`,
        namespace: `namespace-${index % 50}`,
      }),
    );
    const started = performance.now();
    const positions = deterministicLayout(resources);
    expect(Object.keys(positions)).toHaveLength(10_000);
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it('constructs at least twenty-five thousand relationships at the target resource scale', () => {
    const node = resource({
      id: 'node-scale',
      uid: 'node-scale',
      kind: 'Node',
      name: 'worker',
      namespace: undefined,
    });
    const owner = resource({
      id: 'owner-scale',
      uid: 'owner-scale',
      kind: 'Deployment',
      name: 'platform',
    });
    const service = resource({
      id: 'service-scale',
      uid: 'service-scale',
      kind: 'Service',
      name: 'platform',
      properties: { selector: { app: 'platform' } },
    });
    const pods = Array.from({ length: 10_000 }, (_, index) =>
      resource({
        id: `scale-pod-${index}`,
        uid: `scale-pod-${index}`,
        kind: 'Pod',
        name: `scale-pod-${index}`,
        labels: { app: 'platform' },
        ownerUids: [owner.uid],
        properties: { nodeName: node.name },
      }),
    );
    const started = performance.now();
    const relationships = buildRelationships([node, owner, service, ...pods]);
    expect(relationships.length).toBeGreaterThanOrEqual(25_000);
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it('reports zero-ready rollouts and related image pull warnings', () => {
    const deployment = resource({
      id: 'deployment-broken',
      uid: 'deployment-broken',
      kind: 'Deployment',
      name: 'storefront',
      status: '0/2 ready',
      health: 'progressing',
      properties: { desiredReplicas: 2, readyReplicas: 0 },
    });
    const warning = resource({
      id: 'event-pull',
      uid: 'event-pull',
      kind: 'Event',
      name: 'pull-failed',
      properties: { eventType: 'Warning', reason: 'Failed', message: 'Failed to pull image' },
    });
    expect(evaluateDiagnostics(deployment, [warning]).map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(['rollout-incomplete', 'related-image-pull-failure']),
    );
  });
});
