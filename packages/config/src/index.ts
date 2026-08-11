import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
const developmentSessionSecret = 'development-only-session-secret-change-me';
const developmentBootstrapAdminPassword = 'constack-development-admin';

export const runtimeConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().default('mysql://constack:constack@localhost:3306/constack'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    CLUSTER_ID: z.string().default('in-cluster'),
    ACTIONS_ENABLED: booleanString.default(false),
    AI_ENABLED: booleanString.default(false),
    SECRET_METADATA_DISCOVERY_ENABLED: booleanString.default(false),
    METRICS_ENABLED: booleanString.default(true),
    DEMO_MODE: booleanString.default(false),
    RESOURCE_HISTORY_RETENTION_DAYS: z.coerce.number().int().min(1).max(3_650).default(7),
    INCIDENT_RECOMMENDATION_RETENTION_DAYS: z.coerce.number().int().min(1).max(3_650).default(90),
    AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3_650).default(365),
    ACTION_SERVICE_ACCOUNT: z.string().default('constack-actions'),
    POD_NAMESPACE: z.string().default('constack'),
    SESSION_SECRET: z.string().min(32).default(developmentSessionSecret),
    BOOTSTRAP_ORGANIZATION: z.string().default('ConStack'),
    BOOTSTRAP_ADMIN_EMAIL: z.string().email().default('admin@constack.local'),
    BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).default(developmentBootstrapAdminPassword),
    OIDC_ISSUER_URL: z.string().url().optional(),
    OIDC_CLIENT_ID: z.string().optional(),
    OIDC_CLIENT_SECRET: z.string().optional(),
    OIDC_REDIRECT_URL: z.string().url().optional(),
    OIDC_ALLOWED_DOMAINS: z.string().default(''),
    EXTERNAL_ANALYSIS_URL: z.string().url().optional(),
    EXTERNAL_ANALYSIS_AUTH_HEADER: z.string().optional(),
    EXTERNAL_ANALYSIS_ALLOW_EVENTS: booleanString.default(false),
    EXTERNAL_ANALYSIS_ALLOW_METRICS: booleanString.default(false),
    EXTERNAL_ANALYSIS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV !== 'production') return;
    if (config.SESSION_SECRET === developmentSessionSecret) {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'SESSION_SECRET must be replaced in production.',
      });
    }
    if (config.BOOTSTRAP_ADMIN_PASSWORD === developmentBootstrapAdminPassword) {
      context.addIssue({
        code: 'custom',
        path: ['BOOTSTRAP_ADMIN_PASSWORD'],
        message: 'BOOTSTRAP_ADMIN_PASSWORD must be replaced in production.',
      });
    }
  });

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return runtimeConfigSchema.parse(env);
}
