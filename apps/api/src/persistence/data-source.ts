import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadRuntimeConfig } from '@constack/config';
import { ALL_ENTITIES } from './entities.js';
import { InitialSchema1770000000000 } from './migrations/1770000000000-InitialSchema.js';

const config = loadRuntimeConfig();

export const appDataSource = new DataSource({
  type: 'mysql',
  url: config.DATABASE_URL,
  entities: [...ALL_ENTITIES],
  migrations: [InitialSchema1770000000000],
  synchronize: false,
  migrationsRun: false,
  charset: 'utf8mb4',
  timezone: 'Z',
  logging: config.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});
