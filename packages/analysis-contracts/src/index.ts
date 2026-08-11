import { z } from 'zod';

export const ANALYSIS_SCHEMA_VERSION = 1 as const;

const conditionSchema = z.object({
  type: z.string(),
  status: z.string(),
  reason: z.string().optional(),
  message: z.string().max(2_000).optional(),
  lastTransitionTime: z.string().optional(),
});

const diagnosticFindingSchema = z.object({
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

export const externalAnalysisRequestSchema = z
  .object({
    schemaVersion: z.literal(ANALYSIS_SCHEMA_VERSION),
    requestId: z.string().uuid(),
    resource: z
      .object({
        id: z.string().min(1),
        clusterId: z.string().min(1),
        kind: z.string().min(1),
        name: z.string().min(1),
        namespace: z.string().optional(),
        status: z.string(),
        health: z.enum(['healthy', 'progressing', 'degraded', 'unhealthy', 'unknown']),
        conditions: z.array(conditionSchema),
      })
      .strict(),
    findings: z.array(diagnosticFindingSchema),
    eventSummaries: z.array(z.string().max(1_000)).max(50).default([]),
    metricSummaries: z.array(z.string().max(1_000)).max(50).default([]),
    constraints: z
      .object({ recommendationOnly: z.literal(true), noExecution: z.literal(true) })
      .strict(),
  })
  .strict();
export type ExternalAnalysisRequest = z.infer<typeof externalAnalysisRequestSchema>;

export const externalAnalysisResponseSchema = z
  .object({
    schemaVersion: z.literal(ANALYSIS_SCHEMA_VERSION),
    summary: z.string().min(1).max(8_000),
    probableCauses: z.array(z.string().max(2_000)).max(20),
    evidenceReferences: z.array(z.string().max(200)).max(50),
    investigationSteps: z.array(z.string().max(2_000)).max(30),
    suggestedChanges: z.array(z.string().max(4_000)).max(30),
    illustrativeSnippets: z
      .array(
        z
          .object({
            language: z.enum(['text', 'yaml', 'shell']),
            title: z.string().max(200),
            content: z.string().max(10_000),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    risk: z.enum(['low', 'medium', 'high', 'critical']),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type ExternalAnalysisResponse = z.infer<typeof externalAnalysisResponseSchema>;

export interface ExternalAnalysisProvider {
  readonly id: string;
  analyze(request: ExternalAnalysisRequest): Promise<ExternalAnalysisResponse>;
}
