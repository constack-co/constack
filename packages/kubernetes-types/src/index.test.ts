import { describe, expect, it } from 'vitest';
import { normalizeKubernetesObject } from './index.js';

describe('Kubernetes normalization', () => {
  it('never retains Secret values or annotations', () => {
    const resource = normalizeKubernetesObject('local', {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        uid: 'secret-1',
        name: 'credentials',
        namespace: 'default',
        annotations: { token: 'leak' },
      },
      data: { password: 'c2VjcmV0' },
      stringData: { token: 'secret' },
    });
    expect(resource?.annotations).toEqual({});
    const serialized = JSON.stringify(resource);
    expect(serialized).not.toContain('"data"');
    expect(serialized).not.toContain('"stringData"');
    expect(serialized).not.toContain('leak');
  });

  it('derives Secret and ConfigMap references without retaining literal env values', () => {
    const resource = normalizeKubernetesObject('local', {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { uid: 'pod-1', name: 'web', namespace: 'default' },
      spec: {
        containers: [
          {
            name: 'web',
            image: 'example/web:1',
            env: [
              {
                name: 'PASSWORD',
                valueFrom: { secretKeyRef: { name: 'db-secret', key: 'password' } },
              },
              { name: 'MODE', value: 'private-value' },
            ],
            envFrom: [{ configMapRef: { name: 'web-config' } }],
          },
        ],
      },
      status: { phase: 'Running' },
    });
    expect(resource?.properties.secretRefs).toEqual(['db-secret']);
    expect(resource?.properties.configMapRefs).toEqual(['web-config']);
    expect(JSON.stringify(resource)).not.toContain('private-value');
  });

  it('preserves zero replica readiness when Kubernetes omits zero-valued status fields', () => {
    const resource = normalizeKubernetesObject('local', {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { uid: 'deployment-1', name: 'storefront', namespace: 'demo' },
      spec: { replicas: 2 },
      status: {},
    });
    expect(resource?.properties).toMatchObject({
      desiredReplicas: 2,
      readyReplicas: 0,
      availableReplicas: 0,
    });
    expect(resource?.status).toBe('0/2 ready');
  });

  it('projects safe container failure state and marks image pull failures unhealthy', () => {
    const resource = normalizeKubernetesObject('local', {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { uid: 'pod-failed-pull', name: 'storefront-1', namespace: 'demo' },
      spec: { containers: [{ name: 'storefront', image: 'example.invalid/storefront:missing' }] },
      status: {
        phase: 'Pending',
        containerStatuses: [
          {
            name: 'storefront',
            ready: false,
            restartCount: 0,
            state: {
              waiting: { reason: 'ImagePullBackOff', message: 'sensitive registry response' },
            },
          },
        ],
      },
    });
    expect(resource?.health).toBe('unhealthy');
    expect(resource?.status).toBe('ImagePullBackOff');
    expect(resource?.properties.containerStatuses).toEqual([
      {
        name: 'storefront',
        ready: false,
        restartCount: 0,
        state: 'waiting',
        reason: 'ImagePullBackOff',
      },
    ]);
    expect(JSON.stringify(resource)).not.toContain('sensitive registry response');
  });
});
