import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { loadRuntimeConfig } from '@constack/config';
import type { LayoutMode } from '@constack/topology-engine';
import { TopologyService } from './topology.service.js';

@Controller()
export class TopologyController {
  private readonly config = loadRuntimeConfig();
  constructor(private readonly topology: TopologyService) {}

  @Get('capabilities')
  async capabilities() {
    const telemetry = await this.topology.telemetryCapabilities();
    return {
      actions: this.config.ACTIONS_ENABLED,
      externalAnalysis: this.config.AI_ENABLED,
      secretMetadataDiscovery: this.config.SECRET_METADATA_DISCOVERY_ENABLED,
      metrics: this.config.METRICS_ENABLED && telemetry.metrics.available,
      telemetry,
      externalAnalysisContext: {
        resourceSummary: this.config.AI_ENABLED,
        localFindings: this.config.AI_ENABLED,
        eventSummaries: this.config.AI_ENABLED && this.config.EXTERNAL_ANALYSIS_ALLOW_EVENTS,
        metricSummaries: this.config.AI_ENABLED && this.config.EXTERNAL_ANALYSIS_ALLOW_METRICS,
      },
    };
  }

  @Get('topology')
  topologySnapshot(@Query('layout') layout?: LayoutMode) {
    return this.topology.snapshot(layout ?? 'cluster');
  }

  @Get('resources')
  resources(
    @Query('search') search?: string,
    @Query('namespace') namespace?: string,
    @Query('kind') kind?: string,
  ) {
    return this.topology.resources(search, namespace, kind);
  }

  @Get('resources/:id')
  resource(@Param('id') id: string) {
    return this.topology.detail(id);
  }

  @Get('resources/:id/logs')
  logs(
    @Param('id') id: string,
    @Query('container') container?: string,
    @Query('tailLines', new ParseIntPipe({ optional: true })) tailLines?: number,
  ) {
    return this.topology.logs(id, container, tailLines);
  }

  @Get('resources/:id/metrics')
  metrics(@Param('id') id: string) {
    return this.topology.metrics(id);
  }
}
