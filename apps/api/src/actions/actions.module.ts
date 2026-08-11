import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module.js';
import { OperationalAction } from '../persistence/entities.js';
import { TopologyModule } from '../topology/topology.module.js';
import { ActionsController } from './actions.controller.js';
import { ActionsService } from './actions.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([OperationalAction]), TopologyModule, AuditModule],
  providers: [ActionsService],
  controllers: [ActionsController],
})
export class ActionsModule {}
