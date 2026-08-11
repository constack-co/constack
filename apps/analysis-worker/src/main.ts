import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import mysql from 'mysql2/promise';
import { loadRuntimeConfig } from '@constack/config';
import {
  ANALYSIS_SCHEMA_VERSION,
  externalAnalysisRequestSchema,
} from '@constack/analysis-contracts';
import { GenericHttpAnalysisProvider } from './provider.js';

const config = loadRuntimeConfig();
if (!config.AI_ENABLED) throw new Error('analysis-worker must only run when AI_ENABLED=true');
if (!config.EXTERNAL_ANALYSIS_URL) throw new Error('EXTERNAL_ANALYSIS_URL is required');

const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const database = mysql.createPool({ uri: config.DATABASE_URL, connectionLimit: 3, timezone: 'Z' });
const provider = new GenericHttpAnalysisProvider(
  new URL(config.EXTERNAL_ANALYSIS_URL),
  config.EXTERNAL_ANALYSIS_AUTH_HEADER,
  config.EXTERNAL_ANALYSIS_TIMEOUT_MS,
);

interface AnalysisJob {
  recommendationId: string;
  organizationId: string;
  request: unknown;
}

const worker = new Worker<AnalysisJob>(
  'constack-analysis',
  async (job) => {
    if (job.name !== 'analyze') throw new Error('Unsupported analysis job');
    const { recommendationId, organizationId } = job.data;
    const request = externalAnalysisRequestSchema.parse(job.data.request);
    await publish(organizationId, recommendationId, 'running');
    try {
      const result = await provider.analyze(request);
      await database.execute(
        `UPDATE recommendations SET status='completed', result=?, error=NULL, updatedAt=NOW(3) WHERE id=? AND organizationId=?`,
        [JSON.stringify(result), recommendationId, organizationId],
      );
      await publish(organizationId, recommendationId, 'completed');
      return { recommendationId, status: 'completed' };
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 2_000) : 'Unknown provider error';
      await database.execute(
        `UPDATE recommendations SET status='failed', result=NULL, error=?, updatedAt=NOW(3) WHERE id=? AND organizationId=?`,
        [message, recommendationId, organizationId],
      );
      await publish(organizationId, recommendationId, 'failed', message);
      throw error;
    }
  },
  { connection: redis, concurrency: 4 },
);

async function publish(
  organizationId: string,
  recommendationId: string,
  status: string,
  error?: string,
) {
  const sequence = await redis.incr(`constack:realtime:${config.CLUSTER_ID}:analysis:sequence`);
  await redis.publish(
    'constack:realtime',
    JSON.stringify({
      clusterId: config.CLUSTER_ID,
      event: 'analysis.progress',
      payload: {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        clusterId: config.CLUSTER_ID,
        sequence,
        occurredAt: new Date().toISOString(),
        organizationId,
        recommendationId,
        status,
        ...(error ? { error } : {}),
      },
    }),
  );
}

async function shutdown(): Promise<void> {
  await worker.close();
  await database.end();
  await redis.quit();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
