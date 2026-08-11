import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1770000000000 implements MigrationInterface {
  name = 'InitialSchema1770000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const statements = [
      `CREATE TABLE organizations (id char(36) NOT NULL, name varchar(200) NOT NULL, slug varchar(220) NOT NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), UNIQUE KEY IDX_organizations_slug (slug), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE users (id char(36) NOT NULL, email varchar(320) NOT NULL, displayName varchar(200) NOT NULL, passwordHash varchar(255) NULL, oidcSubject varchar(500) NULL, active tinyint NOT NULL DEFAULT 1, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), UNIQUE KEY IDX_users_email (email), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE organization_memberships (id char(36) NOT NULL, organizationId char(36) NOT NULL, userId char(36) NOT NULL, role enum('viewer','operator','administrator') NOT NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), UNIQUE KEY IDX_membership_org_user (organizationId,userId), KEY IDX_membership_user (userId), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE clusters (id char(36) NOT NULL, organizationId char(36) NOT NULL, externalId varchar(200) NOT NULL, name varchar(200) NOT NULL, version varchar(100) NOT NULL DEFAULT 'unknown', status varchar(40) NOT NULL DEFAULT 'unknown', lastSeenAt datetime(3) NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), UNIQUE KEY IDX_clusters_external (externalId), KEY IDX_clusters_org (organizationId), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE cluster_connections (id char(36) NOT NULL, clusterId char(36) NOT NULL, mode varchar(50) NOT NULL DEFAULT 'in-cluster', encryptedCredentialKeyId varchar(100) NULL, encryptedCredentials blob NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), KEY IDX_connections_cluster (clusterId), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE resource_snapshots (id char(36) NOT NULL, organizationId char(36) NOT NULL, clusterId varchar(200) NOT NULL, resourceUid varchar(200) NOT NULL, kind varchar(100) NOT NULL, name varchar(253) NOT NULL, namespace varchar(253) NULL, contentHash varchar(64) NOT NULL, snapshot json NOT NULL, observedAt datetime(3) NOT NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), KEY IDX_snapshots_lookup (clusterId,resourceUid,observedAt), KEY IDX_snapshots_org (organizationId), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE resource_relationships (id char(36) NOT NULL, clusterId varchar(200) NOT NULL, externalId varchar(768) NOT NULL, sourceId varchar(512) NOT NULL, targetId varchar(512) NOT NULL, type varchar(60) NOT NULL, validFrom datetime(3) NOT NULL, validTo datetime(3) NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), UNIQUE KEY IDX_relationship_external (clusterId,externalId(500)), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE integrations (id char(36) NOT NULL, organizationId char(36) NOT NULL, type varchar(100) NOT NULL, name varchar(200) NOT NULL, enabled tinyint NOT NULL DEFAULT 0, configuration json NOT NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), KEY IDX_integrations_org (organizationId), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE alerts (id char(36) NOT NULL, organizationId char(36) NOT NULL, resourceId varchar(512) NOT NULL, severity varchar(30) NOT NULL, title varchar(500) NOT NULL, summary text NOT NULL, resolvedAt datetime(3) NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), KEY IDX_alerts_org (organizationId), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE incidents (id char(36) NOT NULL, organizationId char(36) NOT NULL, title varchar(500) NOT NULL, severity varchar(30) NOT NULL, status varchar(50) NOT NULL DEFAULT 'open', resourceIds json NOT NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), KEY IDX_incidents_org (organizationId), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE recommendations (id char(36) NOT NULL, organizationId char(36) NOT NULL, resourceId varchar(512) NOT NULL, providerId varchar(100) NOT NULL, status varchar(30) NOT NULL DEFAULT 'pending', result json NULL, error text NULL, feedback json NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), KEY IDX_recommendations_org (organizationId), KEY IDX_recommendations_resource (resourceId), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE operational_actions (id char(36) NOT NULL, organizationId char(36) NOT NULL, requestedByUserId char(36) NOT NULL, actionType varchar(100) NOT NULL, resourceId varchar(512) NOT NULL, status varchar(30) NOT NULL DEFAULT 'queued', parameters json NOT NULL, result json NULL, idempotencyKey varchar(100) NOT NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), UNIQUE KEY IDX_actions_idempotency (idempotencyKey), KEY IDX_actions_org (organizationId), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE audit_logs (id char(36) NOT NULL, organizationId char(36) NOT NULL, actorUserId char(36) NULL, eventType varchar(100) NOT NULL, targetId varchar(512) NULL, outcome varchar(30) NOT NULL, details json NOT NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), KEY IDX_audit_org_time (organizationId,createdAt), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE saved_views (id char(36) NOT NULL, organizationId char(36) NOT NULL, userId char(36) NOT NULL, name varchar(200) NOT NULL, layoutMode varchar(50) NOT NULL, state json NOT NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), KEY IDX_views_org (organizationId), KEY IDX_views_user (userId), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE asset_mappings (id char(36) NOT NULL, organizationId char(36) NOT NULL, resourceKind varchar(100) NOT NULL, modelPath varchar(500) NOT NULL, configuration json NOT NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), KEY IDX_assets_org (organizationId), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE user_preferences (id char(36) NOT NULL, userId char(36) NOT NULL, preferenceKey varchar(150) NOT NULL, value json NOT NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), UNIQUE KEY IDX_preferences_user_key (userId,preferenceKey), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE kubernetes_events (id char(36) NOT NULL, organizationId char(36) NOT NULL, clusterId varchar(200) NOT NULL, eventUid varchar(200) NOT NULL, involvedResourceId varchar(512) NULL, reason varchar(200) NULL, eventType varchar(30) NULL, message text NOT NULL, observedAt datetime(3) NOT NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), UNIQUE KEY IDX_events_uid (clusterId,eventUid), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ];
    for (const statement of statements) await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'kubernetes_events',
      'user_preferences',
      'asset_mappings',
      'saved_views',
      'audit_logs',
      'operational_actions',
      'recommendations',
      'incidents',
      'alerts',
      'integrations',
      'resource_relationships',
      'resource_snapshots',
      'cluster_connections',
      'clusters',
      'organization_memberships',
      'users',
      'organizations',
    ])
      await queryRunner.query(`DROP TABLE IF EXISTS ${table}`);
  }
}
