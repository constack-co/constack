import { describe, expect, it } from 'vitest';
import { assetForResource } from './index.js';

describe('assetForResource', () => {
  it('maps Redis container images to the custom Redis model', () => {
    expect(assetForResource({ kind: 'Pod', images: ['redis:8-alpine'] }).modelPath).toBe(
      '/models/redis-3d.glb',
    );
    expect(
      assetForResource({
        kind: 'StatefulSet',
        images: ['docker.io/redis/redis-stack-server@sha256:abc'],
      }).modelPath,
    ).toBe('/models/redis-3d.glb');
  });

  it('keeps the normal kind model for non-Redis containers', () => {
    expect(assetForResource({ kind: 'Pod', images: ['nginx:1.29-alpine'] }).modelPath).toBe(
      '/models/pod-3d.glb',
    );
    expect(assetForResource({ kind: 'Service', images: [] }).modelPath).toBe(
      '/models/service-3d.glb',
    );
    expect(assetForResource({ kind: 'ReplicaSet', images: [] }).modelPath).toBe(
      '/models/replicaset-3d.glb',
    );
    expect(assetForResource({ kind: 'Deployment', images: [] }).modelPath).toBe(
      '/models/deploy-3d.glb',
    );
  });
});
