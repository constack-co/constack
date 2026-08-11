import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { UserRole } from '@constack/shared-types';

abstract class TimestampedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 3 })
  updatedAt!: Date;
}

@Entity('organizations')
export class Organization extends TimestampedEntity {
  @Column({ length: 200 })
  name!: string;

  @Index({ unique: true })
  @Column({ length: 220 })
  slug!: string;
}

@Entity('users')
export class User extends TimestampedEntity {
  @Index({ unique: true })
  @Column({ length: 320 })
  email!: string;

  @Column({ length: 200 })
  displayName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  passwordHash!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  oidcSubject!: string | null;

  @Column({ default: true })
  active!: boolean;
}

@Entity('organization_memberships')
@Index(['organizationId', 'userId'], { unique: true })
export class OrganizationMembership extends TimestampedEntity {
  @Index()
  @Column('uuid')
  organizationId!: string;

  @Index()
  @Column('uuid')
  userId!: string;

  @Column({ type: 'enum', enum: ['viewer', 'operator', 'administrator'] })
  role!: UserRole;
}

@Entity('clusters')
export class Cluster extends TimestampedEntity {
  @Index()
  @Column('uuid')
  organizationId!: string;

  @Index({ unique: true })
  @Column({ length: 200 })
  externalId!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ length: 100, default: 'unknown' })
  version!: string;

  @Column({ length: 40, default: 'unknown' })
  status!: string;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  lastSeenAt!: Date | null;
}

@Entity('cluster_connections')
export class ClusterConnection extends TimestampedEntity {
  @Index()
  @Column('uuid')
  clusterId!: string;

  @Column({ length: 50, default: 'in-cluster' })
  mode!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  encryptedCredentialKeyId!: string | null;

  @Column({ type: 'blob', nullable: true, select: false })
  encryptedCredentials!: Buffer | null;
}

@Entity('resource_snapshots')
@Index(['clusterId', 'resourceUid', 'observedAt'])
export class ResourceSnapshot extends TimestampedEntity {
  @Index()
  @Column('uuid')
  organizationId!: string;

  @Index()
  @Column({ length: 200 })
  clusterId!: string;

  @Column({ length: 200 })
  resourceUid!: string;

  @Column({ length: 100 })
  kind!: string;

  @Column({ length: 253 })
  name!: string;

  @Column({ type: 'varchar', length: 253, nullable: true })
  namespace!: string | null;

  @Column({ length: 64 })
  contentHash!: string;

  @Column({ type: 'json' })
  snapshot!: Record<string, unknown>;

  @Column({ type: 'datetime', precision: 3 })
  observedAt!: Date;
}

@Entity('resource_relationships')
@Index(['clusterId', 'externalId'], { unique: true })
export class ResourceRelationshipEntity extends TimestampedEntity {
  @Index()
  @Column({ length: 200 })
  clusterId!: string;

  @Column({ length: 768 })
  externalId!: string;

  @Column({ length: 512 })
  sourceId!: string;

  @Column({ length: 512 })
  targetId!: string;

  @Column({ length: 60 })
  type!: string;

  @Column({ type: 'datetime', precision: 3 })
  validFrom!: Date;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  validTo!: Date | null;
}

@Entity('integrations')
export class Integration extends TimestampedEntity {
  @Index()
  @Column('uuid')
  organizationId!: string;

  @Column({ length: 100 })
  type!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ default: false })
  enabled!: boolean;

  @Column({ type: 'json' })
  configuration!: Record<string, unknown>;
}

@Entity('alerts')
export class Alert extends TimestampedEntity {
  @Index()
  @Column('uuid')
  organizationId!: string;

  @Column({ length: 512 })
  resourceId!: string;

  @Column({ length: 30 })
  severity!: string;

  @Column({ length: 500 })
  title!: string;

  @Column({ type: 'text' })
  summary!: string;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  resolvedAt!: Date | null;
}

@Entity('incidents')
export class Incident extends TimestampedEntity {
  @Index()
  @Column('uuid')
  organizationId!: string;

  @Column({ length: 500 })
  title!: string;

  @Column({ length: 30 })
  severity!: string;

  @Column({ length: 50, default: 'open' })
  status!: string;

  @Column({ type: 'json' })
  resourceIds!: string[];
}

@Entity('recommendations')
export class Recommendation extends TimestampedEntity {
  @Index()
  @Column('uuid')
  organizationId!: string;

  @Index()
  @Column({ length: 512 })
  resourceId!: string;

  @Column({ length: 100 })
  providerId!: string;

  @Column({ length: 30, default: 'pending' })
  status!: string;

  @Column({ type: 'json', nullable: true })
  result!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'json', nullable: true })
  feedback!: Record<string, unknown> | null;
}

@Entity('operational_actions')
export class OperationalAction extends TimestampedEntity {
  @Index()
  @Column('uuid')
  organizationId!: string;

  @Index()
  @Column('uuid')
  requestedByUserId!: string;

  @Column({ length: 100 })
  actionType!: string;

  @Column({ length: 512 })
  resourceId!: string;

  @Column({ length: 30, default: 'queued' })
  status!: string;

  @Column({ type: 'json' })
  parameters!: Record<string, unknown>;

  @Column({ type: 'json', nullable: true })
  result!: Record<string, unknown> | null;

  @Index({ unique: true })
  @Column({ length: 100 })
  idempotencyKey!: string;
}

@Entity('audit_logs')
@Index(['organizationId', 'createdAt'])
export class AuditLog extends TimestampedEntity {
  @Index()
  @Column('uuid')
  organizationId!: string;

  @Column('uuid', { nullable: true })
  actorUserId!: string | null;

  @Column({ length: 100 })
  eventType!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  targetId!: string | null;

  @Column({ length: 30 })
  outcome!: string;

  @Column({ type: 'json' })
  details!: Record<string, unknown>;
}

@Entity('saved_views')
export class SavedView extends TimestampedEntity {
  @Index()
  @Column('uuid')
  organizationId!: string;

  @Index()
  @Column('uuid')
  userId!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ length: 50 })
  layoutMode!: string;

  @Column({ type: 'json' })
  state!: Record<string, unknown>;
}

@Entity('asset_mappings')
export class AssetMapping extends TimestampedEntity {
  @Index()
  @Column('uuid')
  organizationId!: string;

  @Column({ length: 100 })
  resourceKind!: string;

  @Column({ length: 500 })
  modelPath!: string;

  @Column({ type: 'json' })
  configuration!: Record<string, unknown>;
}

@Entity('user_preferences')
@Index(['userId', 'preferenceKey'], { unique: true })
export class UserPreference extends TimestampedEntity {
  @Index()
  @Column('uuid')
  userId!: string;

  @Column({ length: 150 })
  preferenceKey!: string;

  @Column({ type: 'json' })
  value!: unknown;
}

@Entity('kubernetes_events')
@Index(['clusterId', 'eventUid'], { unique: true })
export class KubernetesEventRecord extends TimestampedEntity {
  @Index()
  @Column('uuid')
  organizationId!: string;

  @Column({ length: 200 })
  clusterId!: string;

  @Column({ length: 200 })
  eventUid!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  involvedResourceId!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reason!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  eventType!: string | null;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'datetime', precision: 3 })
  observedAt!: Date;
}

export const ALL_ENTITIES = [
  Organization,
  User,
  OrganizationMembership,
  Cluster,
  ClusterConnection,
  ResourceSnapshot,
  ResourceRelationshipEntity,
  Integration,
  Alert,
  Incident,
  Recommendation,
  OperationalAction,
  AuditLog,
  SavedView,
  AssetMapping,
  UserPreference,
  KubernetesEventRecord,
] as const;
