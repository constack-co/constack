import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Cluster,
  Incident,
  Integration,
  KubernetesEventRecord,
  OrganizationMembership,
  User,
  UserPreference,
} from '../persistence/entities.js';
import { AuditModule } from '../audit/audit.module.js';
import {
  ClustersController,
  EventsController,
  IncidentsController,
  IntegrationsController,
  PreferencesController,
  UsersController,
} from './management.controllers.js';
import { ManagementService } from './management.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      OrganizationMembership,
      Cluster,
      Integration,
      Incident,
      UserPreference,
      KubernetesEventRecord,
    ]),
    AuditModule,
  ],
  providers: [ManagementService],
  controllers: [
    UsersController,
    ClustersController,
    IntegrationsController,
    IncidentsController,
    PreferencesController,
    EventsController,
  ],
})
export class ManagementModule {}
