import type { Resource } from '@constack/shared-types';

export interface AttentionItem {
  resource: Resource;
  severity: 'critical' | 'warning';
  reason: string;
}

const actionableKinds = new Set([
  'Pod',
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'Job',
  'Node',
  'PersistentVolumeClaim',
]);

export function getAttentionItems(resources: ReadonlyArray<Resource>): AttentionItem[] {
  return resources
    .flatMap((resource): AttentionItem[] => {
      if (!actionableKinds.has(resource.kind)) return [];
      const reason = attentionReason(resource);
      if (!reason) return [];
      return [
        {
          resource,
          severity: resource.health === 'unhealthy' || reason.critical ? 'critical' : 'warning',
          reason: reason.text,
        },
      ];
    })
    .sort((left, right) => {
      if (left.severity !== right.severity) return left.severity === 'critical' ? -1 : 1;
      return `${left.resource.namespace ?? ''}/${left.resource.name}`.localeCompare(
        `${right.resource.namespace ?? ''}/${right.resource.name}`,
      );
    });
}

function attentionReason(resource: Resource): { text: string; critical?: boolean } | undefined {
  if (resource.kind === 'Pod') {
    const blocked = Array.isArray(resource.properties.containerStatuses)
      ? resource.properties.containerStatuses.find(
          (item) =>
            isRecord(item) && typeof item.reason === 'string' && isBlockingReason(item.reason),
        )
      : undefined;
    if (isRecord(blocked))
      return {
        text: `${String(blocked.name ?? 'Container')}: ${String(blocked.reason)}`,
        critical: true,
      };
    if (resource.status === 'Failed') return { text: 'Pod execution failed', critical: true };
    if (resource.status === 'Pending') return { text: 'Pod is pending and not ready' };
  }

  if (['Deployment', 'StatefulSet', 'DaemonSet'].includes(resource.kind)) {
    const desired = resource.properties.desiredReplicas;
    const ready = resource.properties.readyReplicas;
    if (
      typeof desired === 'number' &&
      desired > 0 &&
      typeof ready === 'number' &&
      ready < desired
    ) {
      return { text: `${ready} of ${desired} replicas ready`, critical: ready === 0 };
    }
  }

  if (resource.kind === 'Job' && resource.status === 'Failed')
    return { text: 'Job execution failed' };
  if (resource.kind === 'Node' && resource.health !== 'healthy')
    return { text: `Node is ${resource.status}`, critical: true };
  if (resource.kind === 'PersistentVolumeClaim' && resource.status !== 'Bound')
    return { text: `Volume claim is ${resource.status}` };
  if (resource.health === 'unhealthy') return { text: resource.status, critical: true };
  if (resource.health === 'degraded') return { text: resource.status };
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlockingReason(reason: string): boolean {
  return [
    'CrashLoopBackOff',
    'ImagePullBackOff',
    'ErrImagePull',
    'CreateContainerConfigError',
    'CreateContainerError',
    'RunContainerError',
  ].includes(reason);
}
