import { KubeConfig, Watch } from '@kubernetes/client-node';
import { loadRuntimeConfig } from '@constack/config';
import {
  normalizeKubernetesObject,
  WATCH_DESCRIPTORS,
  type KubernetesObject,
  type WatchDescriptor,
} from '@constack/kubernetes-types';
import { TopologyStore } from './store.js';

const config = loadRuntimeConfig();
const kubeConfig = new KubeConfig();
kubeConfig.loadFromDefault();
const watch = new Watch(kubeConfig);
const store = new TopologyStore(config);
const controllers = new Set<AbortController>();
const resourceVersions = new Map<string, string>();
let stopping = false;

store.upsert({
  id: Buffer.from(`${config.CLUSTER_ID}:cluster`).toString('base64url'),
  logicalId: `Cluster::${config.CLUSTER_ID}`,
  clusterId: config.CLUSTER_ID,
  uid: 'cluster',
  apiVersion: 'v1',
  kind: 'Cluster',
  name: config.CLUSTER_ID,
  observedAt: new Date().toISOString(),
  status: 'Connected',
  health: 'healthy',
  labels: {},
  annotations: {},
  ownerUids: [],
  images: [],
  conditions: [],
  metrics: {},
  properties: {},
});

for (const descriptor of WATCH_DESCRIPTORS) {
  if (descriptor.optionalFeature === 'secretMetadata' && !config.SECRET_METADATA_DISCOVERY_ENABLED)
    continue;
  void startWatch(descriptor, 0);
}

async function startWatch(descriptor: WatchDescriptor, attempt: number): Promise<void> {
  if (stopping) return;
  const initialIds = new Set<string>();
  try {
    const controller = await watch.watch(
      descriptor.path,
      {
        allowWatchBookmarks: true,
        sendInitialEvents: true,
        resourceVersion: resourceVersions.get(descriptor.path) ?? '',
        resourceVersionMatch: 'NotOlderThan',
        timeoutSeconds: 600,
      },
      (phase, raw) => {
        const object = raw as KubernetesObject;
        const resourceVersion = object.metadata?.resourceVersion;
        if (resourceVersion) resourceVersions.set(descriptor.path, resourceVersion);
        if (phase === 'BOOKMARK') {
          if (object.metadata?.annotations?.['k8s.io/initial-events-end'] === 'true')
            store.reconcileKind(descriptor.kind, initialIds);
          return;
        }
        const resource = normalizeKubernetesObject(config.CLUSTER_ID, object);
        if (!resource) return;
        if (phase === 'ADDED') initialIds.add(resource.id);
        if (phase === 'DELETED') store.remove(resource.id);
        else if (phase === 'ADDED' || phase === 'MODIFIED') store.upsert(resource);
      },
      (error) => {
        if (controller) controllers.delete(controller);
        if (stopping) return;
        if (errorStatus(error) === 410) resourceVersions.delete(descriptor.path);
        if (error)
          console.error(
            `Watch ${descriptor.kind} disconnected.`,
            error instanceof Error ? error.message : String(error),
          );
        const delay =
          Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5)) + Math.floor(Math.random() * 500);
        setTimeout(() => void startWatch(descriptor, attempt + 1), delay);
      },
    );
    controllers.add(controller);
  } catch (error) {
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
    console.error(
      `Unable to start ${descriptor.kind} watch.`,
      error instanceof Error ? error.message : String(error),
    );
    setTimeout(() => void startWatch(descriptor, attempt + 1), delay);
  }
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as {
    statusCode?: unknown;
    code?: unknown;
    body?: { code?: unknown };
    response?: { statusCode?: unknown };
  };
  for (const value of [
    record.statusCode,
    record.code,
    record.body?.code,
    record.response?.statusCode,
  ]) {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return undefined;
}

const retentionTimer = setInterval(
  () => void store.runRetention().catch((error) => console.error('Retention failed.', error)),
  24 * 60 * 60 * 1_000,
);
void store.runRetention().catch(() => undefined);

async function shutdown(): Promise<void> {
  stopping = true;
  clearInterval(retentionTimer);
  for (const controller of controllers) controller.abort();
  await store.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
