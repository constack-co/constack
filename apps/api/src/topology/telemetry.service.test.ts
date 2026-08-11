import { describe, expect, it } from 'vitest';
import type { V1Service } from '@kubernetes/client-node';
import { isPrometheusServerService } from './telemetry.service.js';

function service(name: string, applicationName?: string): V1Service {
  return {
    metadata: {
      name,
      namespace: 'monitoring',
      labels: applicationName ? { 'app.kubernetes.io/name': applicationName } : {},
    },
    spec: { clusterIP: '10.0.0.10', ports: [{ name: 'http-web', port: 9090 }], selector: {} },
  };
}

describe('Prometheus service discovery', () => {
  it('recognizes a Prometheus server', () => {
    expect(
      isPrometheusServerService(service('monitoring-kube-prometheus-prometheus', 'prometheus')),
    ).toBe(true);
  });

  it('rejects adjacent components that are not query servers', () => {
    expect(
      isPrometheusServerService(
        service('monitoring-prometheus-node-exporter', 'prometheus-node-exporter'),
      ),
    ).toBe(false);
    expect(
      isPrometheusServerService(
        service('monitoring-kube-prometheus-operator', 'prometheus-operator'),
      ),
    ).toBe(false);
    expect(
      isPrometheusServerService(service('monitoring-kube-prometheus-alertmanager', 'alertmanager')),
    ).toBe(false);
  });
});
