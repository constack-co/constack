import { describe, expect, it } from 'vitest';
import { loadRuntimeConfig } from './index.js';

const productionEnvironment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mysql://constack:password@mysql.example:3306/constack',
  REDIS_URL: 'rediss://redis.example:6379',
  SESSION_SECRET: 'a'.repeat(32),
  BOOTSTRAP_ADMIN_PASSWORD: 'a-safe-production-password',
};

describe('loadRuntimeConfig', () => {
  it('accepts explicit production secrets', () => {
    expect(loadRuntimeConfig(productionEnvironment).NODE_ENV).toBe('production');
  });

  it('rejects the development session secret in production', () => {
    expect(() =>
      loadRuntimeConfig({
        ...productionEnvironment,
        SESSION_SECRET: 'development-only-session-secret-change-me',
      }),
    ).toThrow('SESSION_SECRET must be replaced in production.');
  });

  it('rejects the development bootstrap password in production', () => {
    expect(() =>
      loadRuntimeConfig({
        ...productionEnvironment,
        BOOTSTRAP_ADMIN_PASSWORD: 'constack-development-admin',
      }),
    ).toThrow('BOOTSTRAP_ADMIN_PASSWORD must be replaced in production.');
  });
});
