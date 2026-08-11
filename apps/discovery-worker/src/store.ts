import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import mysql, { type Pool } from 'mysql2/promise';
import {
  SCHEMA_VERSION,
  type Resource,
  type TopologyPatch,
  type TopologySnapshot,
} from '@constack/shared-types';
import { buildRelationships, deterministicLayout } from '@constack/topology-engine';
import type { RuntimeConfig } from '@constack/config';

export class TopologyStore {
  private readonly resources = new Map<string, Resource>();
  private readonly redis: Redis;
  private readonly database: Pool;
  private flushTimer: NodeJS.Timeout | undefined;
  private readonly changed = new Set<string>();
  private readonly removed = new Set<string>();
  private lastRelationships = new Map<string, ReturnType<typeof buildRelationships>[number]>();

  constructor(private readonly config: RuntimeConfig) {
    this.redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.database = mysql.createPool({
      uri: config.DATABASE_URL,
      connectionLimit: 4,
      timezone: 'Z',
    });
  }

  upsert(resource: Resource): void {
    this.resources.set(resource.id, resource);
    this.changed.add(resource.id);
    this.removed.delete(resource.id);
    this.scheduleFlush();
  }

  remove(resourceId: string): void {
    this.resources.delete(resourceId);
    this.changed.delete(resourceId);
    this.removed.add(resourceId);
    this.scheduleFlush();
  }

  reconcileKind(kind: Resource['kind'], observedIds: ReadonlySet<string>): void {
    for (const resource of this.resources.values()) {
      if (resource.kind === kind && !observedIds.has(resource.id)) this.remove(resource.id);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => void this.flush(), 100);
  }

  async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const resources = [...this.resources.values()].sort((a, b) =>
      a.logicalId.localeCompare(b.logicalId),
    );
    const relationships = buildRelationships(resources);
    const nextRelationships = new Map(relationships.map((edge) => [edge.id, edge]));
    const sequence = await this.redis.incr(`constack:topology:${this.config.CLUSTER_ID}:sequence`);
    const changedResources = [...this.changed]
      .map((id) => this.resources.get(id))
      .filter((item): item is Resource => Boolean(item));
    const patch: TopologyPatch = {
      schemaVersion: SCHEMA_VERSION,
      clusterId: this.config.CLUSTER_ID,
      sequence,
      occurredAt: new Date().toISOString(),
      upsertResources: changedResources,
      removeResourceIds: [...this.removed],
      upsertRelationships: relationships.filter(
        (edge) => JSON.stringify(this.lastRelationships.get(edge.id)) !== JSON.stringify(edge),
      ),
      removeRelationshipIds: [...this.lastRelationships.keys()].filter(
        (id) => !nextRelationships.has(id),
      ),
    };
    const snapshot: TopologySnapshot = {
      schemaVersion: SCHEMA_VERSION,
      clusterId: this.config.CLUSTER_ID,
      sequence,
      generatedAt: patch.occurredAt,
      occurredAt: patch.occurredAt,
      resources,
      relationships,
      positions: deterministicLayout(resources),
    };
    await this.redis.set(
      `constack:topology:${this.config.CLUSTER_ID}:snapshot`,
      JSON.stringify(snapshot),
    );
    await this.redis.publish(
      'constack:realtime',
      JSON.stringify({
        clusterId: this.config.CLUSTER_ID,
        event: 'topology.patch',
        payload: patch,
      }),
    );
    for (const resource of changedResources.filter((item) => item.kind === 'Event')) {
      await this.redis.publish(
        'constack:realtime',
        JSON.stringify({
          clusterId: this.config.CLUSTER_ID,
          event: 'resource.event',
          payload: {
            schemaVersion: SCHEMA_VERSION,
            clusterId: this.config.CLUSTER_ID,
            sequence,
            occurredAt: patch.occurredAt,
            resource,
          },
        }),
      );
    }
    await this.persist(changedResources, relationships, patch.removeRelationshipIds);
    this.changed.clear();
    this.removed.clear();
    this.lastRelationships = nextRelationships;
  }

  private async persist(
    resources: Resource[],
    relationships: TopologySnapshot['relationships'],
    removedRelationshipIds: string[],
  ): Promise<void> {
    if (!resources.length && !relationships.length && !removedRelationshipIds.length) return;
    try {
      const [organizations] = await this.database.query<mysql.RowDataPacket[]>(
        'SELECT id FROM organizations WHERE slug = ? LIMIT 1',
        ['default'],
      );
      const organizationId = organizations[0]?.id as string | undefined;
      if (!organizationId) return;
      await this.database.execute(
        `INSERT INTO clusters (id, organizationId, externalId, name, status, lastSeenAt) VALUES (UUID(), ?, ?, ?, 'connected', NOW(3)) ON DUPLICATE KEY UPDATE status='connected', lastSeenAt=NOW(3), updatedAt=NOW(3)`,
        [organizationId, this.config.CLUSTER_ID, this.config.CLUSTER_ID],
      );
      for (const resource of resources) {
        const serialized = JSON.stringify(resource);
        const {
          observedAt: _observedAt,
          resourceVersion: _resourceVersion,
          ...stableResource
        } = resource;
        const hash = createHash('sha256').update(JSON.stringify(stableResource)).digest('hex');
        const [rows] = await this.database.query<mysql.RowDataPacket[]>(
          'SELECT id, contentHash, observedAt FROM resource_snapshots WHERE clusterId=? AND resourceUid=? ORDER BY observedAt DESC LIMIT 1',
          [this.config.CLUSTER_ID, resource.uid],
        );
        const previous = rows[0];
        const oldEnough =
          !previous?.observedAt ||
          Date.now() - new Date(previous.observedAt as string).getTime() >= 60_000;
        if (previous?.contentHash !== hash && oldEnough) {
          await this.database.execute(
            `INSERT INTO resource_snapshots (id, organizationId, clusterId, resourceUid, kind, name, namespace, contentHash, snapshot, observedAt) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              organizationId,
              this.config.CLUSTER_ID,
              resource.uid,
              resource.kind,
              resource.name,
              resource.namespace ?? null,
              hash,
              serialized,
              resource.observedAt,
            ],
          );
        } else if (previous?.contentHash !== hash && previous?.id) {
          await this.database.execute(
            'UPDATE resource_snapshots SET contentHash=?, snapshot=?, observedAt=? WHERE id=?',
            [hash, serialized, resource.observedAt, previous.id],
          );
        }
        if (resource.kind === 'Event') {
          const involvedResourceId =
            typeof resource.properties.involvedObjectUid === 'string'
              ? resource.properties.involvedObjectUid
              : null;
          const reason =
            typeof resource.properties.reason === 'string' ? resource.properties.reason : null;
          const eventType =
            typeof resource.properties.eventType === 'string'
              ? resource.properties.eventType
              : null;
          await this.database.execute(
            `INSERT INTO kubernetes_events (id, organizationId, clusterId, eventUid, involvedResourceId, reason, eventType, message, observedAt) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE reason=VALUES(reason), eventType=VALUES(eventType), message=VALUES(message), observedAt=VALUES(observedAt), updatedAt=NOW(3)`,
            [
              organizationId,
              this.config.CLUSTER_ID,
              resource.uid,
              involvedResourceId,
              reason,
              eventType,
              String(resource.properties.message ?? resource.status),
              resource.observedAt,
            ],
          );
        }
      }
      for (const edge of relationships) {
        await this.database.execute(
          `INSERT INTO resource_relationships (id, clusterId, externalId, sourceId, targetId, type, validFrom, validTo) VALUES (UUID(), ?, ?, ?, ?, ?, NOW(3), NULL) ON DUPLICATE KEY UPDATE sourceId=VALUES(sourceId), targetId=VALUES(targetId), type=VALUES(type), validTo=NULL, updatedAt=NOW(3)`,
          [this.config.CLUSTER_ID, edge.id, edge.source, edge.target, edge.type],
        );
      }
      for (let index = 0; index < removedRelationshipIds.length; index += 250) {
        const chunk = removedRelationshipIds.slice(index, index + 250);
        await this.database.execute(
          `UPDATE resource_relationships SET validTo=NOW(3) WHERE clusterId=? AND externalId IN (${chunk.map(() => '?').join(',')}) AND validTo IS NULL`,
          [this.config.CLUSTER_ID, ...chunk],
        );
      }
    } catch (error) {
      console.error(
        'History persistence failed; live Kubernetes state remains authoritative.',
        error instanceof Error ? error.message : error,
      );
    }
  }

  async runRetention(): Promise<void> {
    const historyDays = this.config.RESOURCE_HISTORY_RETENTION_DAYS;
    const incidentDays = this.config.INCIDENT_RECOMMENDATION_RETENTION_DAYS;
    const auditDays = this.config.AUDIT_RETENTION_DAYS;
    await this.database.execute(
      `DELETE FROM resource_snapshots WHERE observedAt < DATE_SUB(NOW(), INTERVAL ${historyDays} DAY)`,
    );
    await this.database.execute(
      `DELETE FROM kubernetes_events WHERE observedAt < DATE_SUB(NOW(), INTERVAL ${historyDays} DAY)`,
    );
    await this.database.execute(
      `DELETE FROM resource_relationships WHERE validTo IS NOT NULL AND validTo < DATE_SUB(NOW(), INTERVAL ${historyDays} DAY)`,
    );
    await this.database.execute(
      `DELETE FROM recommendations WHERE createdAt < DATE_SUB(NOW(), INTERVAL ${incidentDays} DAY)`,
    );
    await this.database.execute(
      `DELETE FROM incidents WHERE createdAt < DATE_SUB(NOW(), INTERVAL ${incidentDays} DAY)`,
    );
    await this.database.execute(
      `DELETE FROM audit_logs WHERE createdAt < DATE_SUB(NOW(), INTERVAL ${auditDays} DAY)`,
    );
  }

  async close(): Promise<void> {
    if (this.flushTimer) await this.flush();
    await this.redis.quit();
    await this.database.end();
  }
}
