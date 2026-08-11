import { describe, expect, it } from 'vitest';
import type { Resource } from '@constack/shared-types';
import { defaultTopologyLayers, isTopologyResourceVisible } from './topology-visibility';

function resource(kind: Resource['kind']): Resource {
  return {
    kind,
    name: kind.toLocaleLowerCase(),
    namespace: 'demo',
    health: 'healthy',
    status: 'Ready',
  } as Resource;
}

describe('progressive topology layers', () => {
  it('shows applications and Pods by default', () => {
    expect(isTopologyResourceVisible(resource('Deployment'), defaultTopologyLayers)).toBe(true);
    expect(isTopologyResourceVisible(resource('Service'), defaultTopologyLayers)).toBe(true);
    expect(isTopologyResourceVisible(resource('Pod'), defaultTopologyLayers)).toBe(true);
    expect(isTopologyResourceVisible(resource('Node'), defaultTopologyLayers)).toBe(false);
  });

  it('adds infrastructure only when its layer is enabled', () => {
    expect(isTopologyResourceVisible(resource('Pod'), ['workloads', 'replicas'])).toBe(true);
    expect(
      isTopologyResourceVisible(resource('PersistentVolumeClaim'), ['workloads', 'storage']),
    ).toBe(true);
    expect(isTopologyResourceVisible(resource('NetworkPolicy'), ['workloads', 'security'])).toBe(
      true,
    );
  });

  it('never renders event records as scene objects', () => {
    expect(
      isTopologyResourceVisible(resource('Event'), [
        'workloads',
        'replicas',
        'nodes',
        'storage',
        'configuration',
        'security',
        'traffic',
      ]),
    ).toBe(false);
  });
});
