import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import mysql from 'mysql2/promise';
import { loadRuntimeConfig } from '@constack/config';
import { actionPreviewSchema, SCHEMA_VERSION } from '@constack/shared-types';
import { KubernetesActionExecutor, type StoredPreview } from './executor.js';

const config = loadRuntimeConfig();
if (!config.ACTIONS_ENABLED)
  throw new Error('action-worker must only run when ACTIONS_ENABLED=true');
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const database = mysql.createPool({ uri: config.DATABASE_URL, connectionLimit: 3, timezone: 'Z' });
const executor = new KubernetesActionExecutor();

interface ActionJob {
  actionId: string;
  preview: unknown;
}
const worker = new Worker<ActionJob>(
  'constack-actions',
  async (job) => {
    if (job.name !== 'execute-human-confirmed-action') throw new Error('Unsupported action job');
    const base = actionPreviewSchema.parse(job.data.preview);
    const raw = job.data.preview as StoredPreview;
    const preview: StoredPreview = { ...raw, ...base };
    if (!preview.organizationId || !preview.requestedByUserId)
      throw new Error('Human confirmation context is missing');
    await database.execute(
      `UPDATE operational_actions SET status='running', updatedAt=NOW(3) WHERE id=?`,
      [job.data.actionId],
    );
    await publish(job.data.actionId, 'running');
    try {
      const result = await executor.execute(preview);
      await database.execute(
        `UPDATE operational_actions SET status='succeeded', result=?, updatedAt=NOW(3) WHERE id=?`,
        [JSON.stringify(result), job.data.actionId],
      );
      await database.execute(
        `INSERT INTO audit_logs (id, organizationId, actorUserId, eventType, targetId, outcome, details) VALUES (UUID(), ?, ?, 'action.execute', ?, 'succeeded', ?)`,
        [
          preview.organizationId,
          preview.requestedByUserId,
          preview.target.id,
          JSON.stringify({ actionId: job.data.actionId, action: preview.action }),
        ],
      );
      await publish(job.data.actionId, 'succeeded', result);
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 2_000) : 'Unknown execution error';
      await database.execute(
        `UPDATE operational_actions SET status='failed', result=?, updatedAt=NOW(3) WHERE id=?`,
        [JSON.stringify({ error: message }), job.data.actionId],
      );
      await database.execute(
        `INSERT INTO audit_logs (id, organizationId, actorUserId, eventType, targetId, outcome, details) VALUES (UUID(), ?, ?, 'action.execute', ?, 'failed', ?)`,
        [
          preview.organizationId,
          preview.requestedByUserId,
          preview.target.id,
          JSON.stringify({ actionId: job.data.actionId, action: preview.action, error: message }),
        ],
      );
      await publish(job.data.actionId, 'failed', { error: message });
      throw error;
    }
  },
  { connection: redis, concurrency: 2 },
);

async function publish(actionId: string, status: string, result?: Record<string, unknown>) {
  const sequence = await redis.incr(`constack:realtime:${config.CLUSTER_ID}:actions:sequence`);
  await redis.publish(
    'constack:realtime',
    JSON.stringify({
      clusterId: config.CLUSTER_ID,
      event: 'action.progress',
      payload: {
        schemaVersion: SCHEMA_VERSION,
        clusterId: config.CLUSTER_ID,
        sequence,
        occurredAt: new Date().toISOString(),
        actionId,
        status,
        ...(result ? { result } : {}),
      },
    }),
  );
}
async function shutdown() {
  await worker.close();
  await database.end();
  await redis.quit();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
