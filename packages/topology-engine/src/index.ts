import type {
  DiagnosticFinding,
  HealthState,
  Position,
  Relationship,
  RelationshipType,
  Resource,
} from '@constack/shared-types';

export type LayoutMode =
  | 'cluster'
  | 'namespace'
  | 'application'
  | 'service'
  | 'node'
  | 'incident'
  | 'trace';

function hash(input: string): number {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

const layerByKind: Record<string, number> = {
  Cluster: 0,
  Node: 1,
  Namespace: 1,
  Deployment: 2,
  StatefulSet: 2,
  DaemonSet: 2,
  Service: 2,
  Ingress: 2,
  Job: 2,
  CronJob: 2,
  ReplicaSet: 3,
  Pod: 4,
  PersistentVolumeClaim: 3,
  PersistentVolume: 4,
  ConfigMap: 3,
  Secret: 3,
};

export function deterministicLayout(
  resources: ReadonlyArray<Resource>,
  mode: LayoutMode = 'cluster',
): Record<string, Position> {
  const sorted = [...resources].sort((a, b) => a.logicalId.localeCompare(b.logicalId));
  const groups = new Map<string, Resource[]>();
  for (const resource of sorted) {
    const groupKey =
      mode === 'node'
        ? String(resource.properties.nodeName ?? 'unassigned')
        : mode === 'application'
          ? (resource.labels['app.kubernetes.io/name'] ?? resource.namespace ?? '_cluster')
          : mode === 'service'
            ? resource.kind === 'Service'
              ? resource.id
              : (resource.namespace ?? '_cluster')
            : (resource.namespace ?? '_cluster');
    const group = groups.get(groupKey) ?? [];
    group.push(resource);
    groups.set(groupKey, group);
  }

  const result: Record<string, Position> = {};
  const groupEntries = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const groupColumns = Math.max(1, Math.ceil(Math.sqrt(groupEntries.length)));
  groupEntries.forEach(([groupKey, group], groupIndex) => {
    const groupX = (groupIndex % groupColumns) * 34 - ((groupColumns - 1) * 34) / 2;
    const groupZ = Math.floor(groupIndex / groupColumns) * 34;
    const byLayer = new Map<number, Resource[]>();
    for (const resource of group) {
      const layer = layerByKind[resource.kind] ?? 3;
      const layerResources = byLayer.get(layer) ?? [];
      layerResources.push(resource);
      byLayer.set(layer, layerResources);
    }
    for (const [layer, layerResources] of byLayer) {
      layerResources.forEach((resource, index) => {
        const radius = Math.max(4, Math.ceil(layerResources.length / 10) * 3.5);
        const angle = (index / Math.max(1, layerResources.length)) * Math.PI * 2;
        const jitter = (hash(`${groupKey}:${resource.logicalId}`) % 1000) / 1000 - 0.5;
        result[resource.id] = {
          x: groupX + Math.cos(angle) * (radius + jitter),
          y: layer * 4,
          z: groupZ + Math.sin(angle) * (radius + jitter),
        };
      });
    }
  });
  return result;
}

function relationId(source: string, target: string, type: RelationshipType): string {
  return `${type}:${source}:${target}`;
}

export function buildRelationships(resources: ReadonlyArray<Resource>): Relationship[] {
  const byUid = new Map(resources.map((resource) => [resource.uid, resource]));
  const byName = new Map(
    resources.map((resource) => [
      `${resource.kind}:${resource.namespace ?? ''}:${resource.name}`,
      resource,
    ]),
  );
  const relationships = new Map<string, Relationship>();
  const add = (source: Resource, target: Resource, type: RelationshipType) => {
    const id = relationId(source.id, target.id, type);
    relationships.set(id, {
      id,
      clusterId: source.clusterId,
      source: source.id,
      target: target.id,
      type,
      health: target.health,
      metadata: {},
    });
  };

  for (const resource of resources) {
    for (const ownerUid of resource.ownerUids) {
      const owner = byUid.get(ownerUid);
      if (owner) add(owner, resource, 'owns');
    }
    if (resource.namespace && resource.kind !== 'Namespace') {
      const namespace = byName.get(`Namespace::${resource.namespace}`);
      if (namespace) add(namespace, resource, 'contains');
    }
    const nodeName = resource.properties.nodeName;
    if (resource.kind === 'Pod' && typeof nodeName === 'string') {
      const node = byName.get(`Node::${nodeName}`);
      if (node) add(resource, node, 'scheduled-on');
    }
    for (const targetUid of stringArray(resource.properties.endpointTargetUids)) {
      const target = byUid.get(targetUid);
      if (target) add(resource, target, 'routes-to');
    }
    if (
      resource.kind === 'Service' &&
      isStringRecord(resource.properties.selector) &&
      Object.keys(resource.properties.selector).length > 0
    ) {
      for (const candidate of resources) {
        if (
          candidate.kind === 'Pod' &&
          candidate.namespace === resource.namespace &&
          selectorMatches(candidate.labels, resource.properties.selector)
        )
          add(resource, candidate, 'routes-to');
      }
    }
    if (resource.kind === 'NetworkPolicy' && isStringRecord(resource.properties.podSelector)) {
      for (const candidate of resources) {
        if (
          candidate.kind === 'Pod' &&
          candidate.namespace === resource.namespace &&
          selectorMatches(candidate.labels, resource.properties.podSelector)
        )
          add(resource, candidate, 'governs');
      }
    }
    for (const serviceName of stringArray(resource.properties.serviceNames)) {
      const service = byName.get(`Service:${resource.namespace ?? ''}:${serviceName}`);
      if (service) add(resource, service, resource.kind === 'Ingress' ? 'exposes' : 'routes-to');
    }
    for (const claimName of stringArray(resource.properties.persistentVolumeClaims)) {
      const claim = byName.get(`PersistentVolumeClaim:${resource.namespace ?? ''}:${claimName}`);
      if (claim) add(resource, claim, 'mounts');
    }
    const volumeName = resource.properties.volumeName;
    if (resource.kind === 'PersistentVolumeClaim' && typeof volumeName === 'string') {
      const volume = byName.get(`PersistentVolume::${volumeName}`);
      if (volume) add(resource, volume, 'binds');
    }
    for (const configMapName of stringArray(resource.properties.configMapRefs)) {
      const configMap = byName.get(`ConfigMap:${resource.namespace ?? ''}:${configMapName}`);
      if (configMap) add(resource, configMap, 'configures');
    }
    for (const secretName of stringArray(resource.properties.secretRefs)) {
      const secret = byName.get(`Secret:${resource.namespace ?? ''}:${secretName}`);
      if (secret) add(resource, secret, 'configures');
    }
    const serviceAccountName = resource.properties.serviceAccountName;
    if (typeof serviceAccountName === 'string') {
      const account = byName.get(
        `ServiceAccount:${resource.namespace ?? ''}:${serviceAccountName}`,
      );
      if (account) add(resource, account, 'authenticates-as');
    }
    const scaleTarget = resource.properties.scaleTarget;
    if (isRecord(scaleTarget)) {
      const target = byName.get(
        `${String(scaleTarget.kind)}:${resource.namespace ?? ''}:${String(scaleTarget.name)}`,
      );
      if (target) add(resource, target, 'scales');
    }
  }
  return [...relationships.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function selectorMatches(
  labels: Record<string, string>,
  selector: Record<string, string>,
): boolean {
  return Object.entries(selector).every(([key, value]) => labels[key] === value);
}

export function evaluateDiagnostics(
  resource: Resource,
  relatedEvents: ReadonlyArray<Resource> = [],
): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const add = (
    ruleId: string,
    title: string,
    summary: string,
    severity: 'info' | 'warning' | 'critical',
    remediation: string[],
  ) => {
    findings.push({
      id: `${ruleId}:${resource.id}`,
      resourceId: resource.id,
      ruleId,
      title,
      summary,
      severity,
      evidence: [{ id: resource.resourceVersion ?? resource.uid, summary: resource.status }],
      investigationSteps: ['Review resource conditions and recent Kubernetes events.'],
      suggestedRemediation: remediation,
      observedAt: resource.observedAt,
    });
  };
  if (resource.health === 'unhealthy') {
    add('resource-unhealthy', `${resource.kind} is unhealthy`, resource.status, 'critical', [
      'Validate the owning workload configuration in GitOps before changing the cluster.',
    ]);
  } else if (resource.health === 'degraded') {
    add('resource-degraded', `${resource.kind} is degraded`, resource.status, 'warning', [
      'Inspect events, probes, resource pressure, and rollout state.',
    ]);
  }
  const restarts = resource.properties.restartCount;
  if (typeof restarts === 'number' && restarts >= 3) {
    add(
      'pod-restarts',
      'Repeated container restarts',
      `${restarts} restarts were observed.`,
      restarts >= 10 ? 'critical' : 'warning',
      ['Inspect previous container logs and probe configuration.'],
    );
  }
  if (
    resource.kind === 'Pod' &&
    resource.conditions.some((condition) =>
      /probe/i.test(`${condition.reason ?? ''} ${condition.message ?? ''}`),
    )
  ) {
    add(
      'probe-failure',
      'Container probe failures detected',
      'A Kubernetes condition references a failed health probe.',
      'warning',
      ['Review liveness, readiness, and startup probe timing against application behavior.'],
    );
  }
  if (resource.kind === 'Pod' && Array.isArray(resource.properties.containerStatuses)) {
    const blocked = resource.properties.containerStatuses.find(
      (item) =>
        isRecord(item) &&
        typeof item.reason === 'string' &&
        [
          'CrashLoopBackOff',
          'ImagePullBackOff',
          'ErrImagePull',
          'CreateContainerConfigError',
          'CreateContainerError',
          'RunContainerError',
        ].includes(item.reason),
    );
    if (isRecord(blocked)) {
      const reason = String(blocked.reason);
      add(
        reason === 'CrashLoopBackOff' ? 'container-crash-loop' : 'container-start-failure',
        reason === 'CrashLoopBackOff'
          ? 'Container is repeatedly crashing'
          : 'Container cannot start',
        `${String(blocked.name ?? 'Container')} is waiting with ${reason}.`,
        'critical',
        [
          reason.includes('Image') || reason === 'ErrImagePull'
            ? 'Verify the image name, tag, registry access, and image pull credentials in GitOps.'
            : 'Inspect the container state, previous logs, and workload configuration.',
        ],
      );
    }
  }
  if (
    resource.kind === 'Deployment' ||
    resource.kind === 'StatefulSet' ||
    resource.kind === 'DaemonSet'
  ) {
    const desired = resource.properties.desiredReplicas;
    const ready = resource.properties.readyReplicas;
    if (typeof desired === 'number' && typeof ready === 'number' && ready < desired) {
      add(
        'rollout-incomplete',
        'Workload rollout is incomplete',
        `${ready} of ${desired} desired replicas are ready.`,
        ready === 0 ? 'critical' : 'warning',
        ['Inspect rollout conditions, unavailable replicas, scheduling, and image pull events.'],
      );
    }
  }
  if (resource.kind === 'Node' && resource.health !== 'healthy') {
    add('node-condition', 'Node is not Ready', resource.status, 'critical', [
      'Review node pressure conditions, kubelet status, and provider health.',
    ]);
  }
  if (resource.kind === 'Job' && resource.status === 'Failed') {
    add('job-failed', 'Job execution failed', resource.status, 'warning', [
      'Inspect Job and Pod events and verify whether retrying could repeat external side effects.',
    ]);
  }
  if (resource.kind === 'PersistentVolumeClaim' && resource.status !== 'Bound') {
    add('pvc-unbound', 'PersistentVolumeClaim is not bound', resource.status, 'warning', [
      'Review StorageClass, access mode, requested capacity, and provisioner events.',
    ]);
  }
  if (resource.kind === 'Event' && resource.properties.eventType === 'Warning') {
    add(
      'warning-event',
      String(resource.properties.reason ?? 'Kubernetes warning event'),
      'Kubernetes emitted a Warning event for the involved resource.',
      'warning',
      ['Inspect the involved resource and adjacent events in chronological order.'],
    );
  }
  const warnings = relatedEvents.filter(
    (event) => event.kind === 'Event' && event.properties.eventType === 'Warning',
  );
  const warningText = warnings
    .map(
      (event) =>
        `${String(event.properties.reason ?? '')} ${String(event.properties.message ?? '')}`,
    )
    .join(' ');
  if (/ImagePullBackOff|ErrImagePull|Failed to pull image|pull access denied/i.test(warningText)) {
    add(
      'related-image-pull-failure',
      'A workload container image cannot be pulled',
      'Recent warning events report an image pull failure for this resource or one of its Pods.',
      'critical',
      [
        'Verify the image name, tag, registry availability, and image pull credentials in Helm or GitOps.',
      ],
    );
  } else if (/FailedScheduling|Insufficient|didn't match|untolerated taint/i.test(warningText)) {
    add(
      'related-scheduling-failure',
      'A Pod cannot be scheduled',
      'Recent warning events report a scheduling failure for this resource or one of its Pods.',
      'warning',
      ['Review resource requests, node capacity, affinity, selectors, taints, and tolerations.'],
    );
  } else if (/BackOff|Unhealthy|FailedMount|FailedAttachVolume/i.test(warningText)) {
    add(
      'related-kubernetes-warning',
      'Kubernetes reports an active workload problem',
      'Recent warning events affect this resource or one of its Pods.',
      'warning',
      ['Review the related warning events, Pod status, and previous container logs.'],
    );
  }
  const containerResources = resource.properties.containerResources;
  if (
    Array.isArray(containerResources) &&
    containerResources.some(
      (item) =>
        isRecord(item) &&
        (Object.keys(isRecord(item.requests) ? item.requests : {}).length === 0 ||
          Object.keys(isRecord(item.limits) ? item.limits : {}).length === 0),
    )
  ) {
    add(
      'resource-configuration',
      'Container resource policy is incomplete',
      'At least one container has no requests or limits.',
      'info',
      ['Define reviewed CPU and memory requests/limits in Helm or GitOps configuration.'],
    );
  }
  return findings;
}

export function healthRank(health: HealthState): number {
  switch (health) {
    case 'healthy':
      return 0;
    case 'progressing':
      return 1;
    case 'unknown':
      return 2;
    case 'degraded':
      return 3;
    case 'unhealthy':
      return 4;
  }
}
