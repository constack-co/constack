import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { loadRuntimeConfig } from '@constack/config';
import { CommonModule } from './common/common.module.js';
import { ALL_ENTITIES } from './persistence/entities.js';
import { AuthModule } from './auth/auth.module.js';
import { SessionGuard } from './auth/session.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { AuditModule } from './audit/audit.module.js';
import { TopologyModule } from './topology/topology.module.js';
import { ViewsModule } from './views/views.module.js';
import { RecommendationsModule } from './recommendations/recommendations.module.js';
import { ActionsModule } from './actions/actions.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { HealthModule } from './health/health.module.js';
import { InitialSchema1770000000000 } from './persistence/migrations/1770000000000-InitialSchema.js';
import { ManagementModule } from './management/management.module.js';

const config = loadRuntimeConfig();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 240 }]),
    TypeOrmModule.forRoot({
      type: 'mysql',
      url: config.DATABASE_URL,
      entities: [...ALL_ENTITIES],
      migrations: [InitialSchema1770000000000],
      synchronize: false,
      migrationsRun: true,
      charset: 'utf8mb4',
      timezone: 'Z',
    }),
    CommonModule,
    AuthModule,
    AuditModule,
    TopologyModule,
    ViewsModule,
    ManagementModule,
    ...(config.AI_ENABLED ? [RecommendationsModule] : []),
    ...(config.ACTIONS_ENABLED ? [ActionsModule] : []),
    RealtimeModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
