/// <reference lib="webworker" />

interface LayoutItem {
  id: string;
  logicalId: string;
  kind: string;
  namespace?: string;
  labels: Record<string, string>;
  properties: Record<string, unknown>;
}

type LayoutMode =
  | 'cluster'
  | 'namespace'
  | 'application'
  | 'service'
  | 'node'
  | 'incident'
  | 'trace';

const stageByKind: Record<string, number> = {
  ExternalAPI: 0,
  Ingress: 0,
  Service: 1,
  Endpoints: 1,
  EndpointSlice: 1,
  Deployment: 2,
  StatefulSet: 2,
  DaemonSet: 2,
  Job: 2,
  CronJob: 2,
  Database: 3,
  Queue: 3,
  Cache: 3,
  ReplicaSet: 3,
  Pod: 4,
  PersistentVolumeClaim: 5,
  PersistentVolume: 5,
  StorageClass: 5,
  ConfigMap: 4,
  Secret: 4,
  HorizontalPodAutoscaler: 4,
  ServiceAccount: 4,
  NetworkPolicy: 4,
  Namespace: 5,
  Node: 5,
  Cluster: 5,
};

const heightByKind: Record<string, number> = {
  Ingress: 3.2,
  ExternalAPI: 3.2,
  Service: 2.3,
  Endpoints: 2.1,
  EndpointSlice: 2.1,
  Deployment: 1.5,
  StatefulSet: 1.5,
  DaemonSet: 1.5,
  Job: 1.5,
  CronJob: 1.5,
};

self.onmessage = (event: MessageEvent<{ resources: LayoutItem[]; mode: LayoutMode }>) => {
  const resources = [...event.data.resources].sort((a, b) =>
    a.logicalId.localeCompare(b.logicalId),
  );
  const groups = new Map<string, LayoutItem[]>();
  for (const resource of resources) {
    const key = groupKey(resource, event.data.mode);
    const group = groups.get(key) ?? [];
    group.push(resource);
    groups.set(key, group);
  }

  const entries = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  const columns = Math.max(1, Math.ceil(Math.sqrt(entries.length)));
  const rows = Math.max(1, Math.ceil(entries.length / columns));
  const widestStage = Math.max(1, ...entries.flatMap(([, group]) => stageCounts(group)));
  const groupWidth = Math.max(24, widestStage * 5.2 + 10);
  const groupDepth = 44;
  const positions: Record<string, { x: number; y: number; z: number }> = {};

  entries.forEach(([, group], groupIndex) => {
    const column = groupIndex % columns;
    const row = Math.floor(groupIndex / columns);
    const groupX = (column - (columns - 1) / 2) * (groupWidth + 8);
    const groupZ = (row - (rows - 1) / 2) * (groupDepth + 9);
    const stages = new Map<number, LayoutItem[]>();

    for (const resource of group) {
      const stage = stageByKind[resource.kind] ?? 4;
      const items = stages.get(stage) ?? [];
      items.push(resource);
      stages.set(stage, items);
    }

    for (const [stage, items] of stages) {
      items.forEach((resource, index) => {
        const columnsInStage = Math.min(8, items.length);
        const itemRow = Math.floor(index / columnsInStage);
        const itemColumn = index % columnsInStage;
        const rowWidth = Math.min(columnsInStage, items.length - itemRow * columnsInStage);
        positions[resource.id] = {
          x: groupX + (itemColumn - (rowWidth - 1) / 2) * 5.2,
          y: heightByKind[resource.kind] ?? 1.25,
          z: groupZ + (stage - 2.5) * 7 + itemRow * 4.2,
        };
      });
    }
  });

  self.postMessage(positions);
};

function groupKey(resource: LayoutItem, mode: LayoutMode): string {
  if (mode === 'node') return String(resource.properties.nodeName ?? 'unassigned');
  if (mode === 'application' || mode === 'service') {
    return (
      resource.labels['app.kubernetes.io/name'] ??
      resource.labels.app ??
      resource.namespace ??
      'cluster'
    );
  }
  return resource.namespace ?? 'cluster';
}

function stageCounts(resources: LayoutItem[]): number[] {
  const counts = new Map<number, number>();
  for (const resource of resources) {
    const stage = stageByKind[resource.kind] ?? 4;
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return [...counts.values()];
}

export {};
