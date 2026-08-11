import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

export const resourceKindSchema = z.enum([
  'Cluster',
  'Node',
  'Namespace',
  'Deployment',
  'ReplicaSet',
  'StatefulSet',
  'DaemonSet',
  'Pod',
  'Service',
  'Endpoints',
  'EndpointSlice',
  'Ingress',
  'Job',
  'CronJob',
  'PersistentVolume',
  'PersistentVolumeClaim',
  'StorageClass',
  'ConfigMap',
  'Secret',
  'NetworkPolicy',
  'HorizontalPodAutoscaler',
  'ServiceAccount',
  'Event',
  'Database',
  'Queue',
  'Cache',
  'ExternalAPI',
]);
export type ResourceKind = z.infer<typeof resourceKindSchema>;

export const healthStateSchema = z.enum([
  'healthy',
  'progressing',
  'degraded',
  'unhealthy',
  'unknown',
]);
export type HealthState = z.infer<typeof healthStateSchema>;

export const resourceRefSchema = z.object({
  id: z.string().min(1),
  clusterId: z.string().min(1),
  uid: z.string().min(1),
  apiVersion: z.string().min(1),
  kind: resourceKindSchema,
  name: z.string().min(1),
  namespace: z.string().optional(),
});
export type ResourceRef = z.infer<typeof resourceRefSchema>;

export const conditionSchema = z.object({
  type: z.string(),
  status: z.string(),
  reason: z.string().optional(),
  message: z.string().max(2_000).optional(),
  lastTransitionTime: z.string().optional(),
});

export const metricValueSchema = z.object({
  value: z.number(),
  unit: z.string(),
  observedAt: z.string(),
});

export const resourceSchema = resourceRefSchema.extend({
  logicalId: z.string().min(1),
  resourceVersion: z.string().optional(),
  createdAt: z.string().optional(),
  observedAt: z.string(),
  status: z.string(),
  health: healthStateSchema,
  labels: z.record(z.string(), z.string()).default({}),
  annotations: z.record(z.string(), z.string()).default({}),
  ownerUids: z.array(z.string()).default([]),
  images: z.array(z.string()).default([]),
  conditions: z.array(conditionSchema).default([]),
  metrics: z.record(z.string(), metricValueSchema).default({}),
  properties: z.record(z.string(), z.unknown()).default({}),
});
export type Resource = z.infer<typeof resourceSchema>;

export const relationshipTypeSchema = z.enum([
  'contains',
  'owns',
  'scheduled-on',
  'routes-to',
  'exposes',
  'mounts',
  'binds',
  'configures',
  'authenticates-as',
  'scales',
  'governs',
  'involved-in',
  'depends-on',
  'traffic',
  'trace',
]);
export type RelationshipType = z.infer<typeof relationshipTypeSchema>;

export const relationshipSchema = z.object({
  id: z.string().min(1),
  clusterId: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  type: relationshipTypeSchema,
  health: healthStateSchema.default('unknown'),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type Relationship = z.infer<typeof relationshipSchema>;

export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export type Position = z.infer<typeof positionSchema>;

export const topologySnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  clusterId: z.string(),
  sequence: z.number().int().nonnegative(),
  generatedAt: z.string(),
  occurredAt: z.string(),
  resources: z.array(resourceSchema),
  relationships: z.array(relationshipSchema),
  positions: z.record(z.string(), positionSchema).default({}),
});
export type TopologySnapshot = z.infer<typeof topologySnapshotSchema>;

export const topologyPatchSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  clusterId: z.string(),
  sequence: z.number().int().positive(),
  occurredAt: z.string(),
  upsertResources: z.array(resourceSchema).default([]),
  removeResourceIds: z.array(z.string()).default([]),
  upsertRelationships: z.array(relationshipSchema).default([]),
  removeRelationshipIds: z.array(z.string()).default([]),
});
export type TopologyPatch = z.infer<typeof topologyPatchSchema>;

export const diagnosticFindingSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  ruleId: z.string(),
  title: z.string(),
  summary: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
  evidence: z.array(z.object({ id: z.string(), summary: z.string() })),
  investigationSteps: z.array(z.string()),
  suggestedRemediation: z.array(z.string()),
  observedAt: z.string(),
});
export type DiagnosticFinding = z.infer<typeof diagnosticFindingSchema>;

const recommendationRiskSchema = z.enum(['low', 'medium', 'high', 'critical']);

export const actionTypeSchema = z.enum([
  'restart-pod',
  'delete-failed-pod',
  'rollout-restart-deployment',
  'rollout-restart-statefulset',
  'scale-deployment',
  'scale-statefulset',
  'retry-job',
  'suspend-cronjob',
  'resume-cronjob',
]);
export type ActionType = z.infer<typeof actionTypeSchema>;

export const actionPreviewRequestSchema = z
  .object({
    action: actionTypeSchema,
    resourceId: z.string().min(1),
    parameters: z.object({ replicas: z.number().int().min(0).max(10_000).optional() }).strict(),
  })
  .strict();
export type ActionPreviewRequest = z.infer<typeof actionPreviewRequestSchema>;

export const actionPreviewSchema = z.object({
  id: z.string().uuid(),
  action: actionTypeSchema,
  target: resourceRefSchema,
  resourceVersion: z.string(),
  impact: z.string(),
  risk: recommendationRiskSchema,
  operationSummary: z.string(),
  allowed: z.boolean(),
  denialReason: z.string().optional(),
  expiresAt: z.string(),
});
export type ActionPreview = z.infer<typeof actionPreviewSchema>;

export const userRoleSchema = z.enum(['viewer', 'operator', 'administrator']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const capabilitiesSchema = z.object({
  actions: z.boolean(),
  externalAnalysis: z.boolean(),
  secretMetadataDiscovery: z.boolean(),
  metrics: z.boolean(),
  externalAnalysisContext: z.object({
    resourceSummary: z.boolean(),
    localFindings: z.boolean(),
    eventSummaries: z.boolean(),
    metricSummaries: z.boolean(),
  }),
  telemetry: z
    .object({
      providers: z.array(
        z.object({
          id: z.string(),
          type: z.enum(['kubernetes-metrics', 'prometheus']),
          name: z.string(),
          namespace: z.string().optional(),
          capabilities: z.array(z.enum(['metrics', 'traffic', 'traces'])),
        }),
      ),
      metrics: z.object({
        available: z.boolean(),
        provider: z.string().optional(),
        reason: z.string().optional(),
      }),
      traffic: z.object({
        available: z.boolean(),
        provider: z.string().optional(),
        reason: z.string().optional(),
      }),
      traces: z.object({
        available: z.boolean(),
        provider: z.string().optional(),
        reason: z.string().optional(),
      }),
    })
    .optional(),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

export interface ObservabilityAdapter {
  readonly id: string;
  capabilities(): Promise<ReadonlyArray<'metrics' | 'logs' | 'traces' | 'traffic'>>;
  health(): Promise<{ healthy: boolean; message?: string }>;
  metrics(resource: ResourceRef, from: Date, to: Date): Promise<Record<string, unknown>>;
  logs(resource: ResourceRef, options: Record<string, unknown>): Promise<ReadonlyArray<string>>;
  traces(resource: ResourceRef, from: Date, to: Date): Promise<ReadonlyArray<unknown>>;
  traffic(resource: ResourceRef, from: Date, to: Date): Promise<ReadonlyArray<unknown>>;
}
