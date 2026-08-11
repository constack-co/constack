import { Module } from '@nestjs/common';
import { TopologyController } from './topology.controller.js';
import { TopologyService } from './topology.service.js';
import { TelemetryService } from './telemetry.service.js';

@Module({
  providers: [TopologyService, TelemetryService],
  controllers: [TopologyController],
  exports: [TopologyService, TelemetryService],
})
export class TopologyModule {}
