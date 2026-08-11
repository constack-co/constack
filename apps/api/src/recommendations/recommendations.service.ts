import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { loadRuntimeConfig } from '@constack/config';
import {
  ANALYSIS_SCHEMA_VERSION,
  externalAnalysisRequestSchema,
} from '@constack/analysis-contracts';
import { evaluateDiagnostics } from '@constack/topology-engine';
import { RedisService } from '../common/redis.service.js';
import { Recommendation } from '../persistence/entities.js';
import { TopologyService } from '../topology/topology.service.js';

@Injectable()
export class RecommendationsService {
  private readonly config = loadRuntimeConfig();
  private readonly queue: Queue;

  constructor(
    @InjectRepository(Recommendation) private readonly recommendations: Repository<Recommendation>,
    private readonly topology: TopologyService,
    redis: RedisService,
  ) {
    this.queue = new Queue('constack-analysis', { connection: redis.client });
  }

  list(organizationId: string, resourceId?: string) {
    return this.recommendations.find({
      where: { organizationId, ...(resourceId ? { resourceId } : {}) },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async request(
    organizationId: string,
    resourceId: string,
    includeEvents: boolean,
    includeMetrics: boolean,
  ) {
    if (!this.config.AI_ENABLED) throw new NotFoundException('External analysis is not enabled');
    const detail = await this.topology.detail(resourceId);
    const recommendation = await this.recommendations.save(
      this.recommendations.create({
        organizationId,
        resourceId,
        providerId: 'generic-http',
        status: 'pending',
        result: null,
        error: null,
        feedback: null,
      }),
    );
    const analysisRequest = externalAnalysisRequestSchema.parse({
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      requestId: crypto.randomUUID(),
      resource: {
        id: detail.resource.id,
        clusterId: detail.resource.clusterId,
        kind: detail.resource.kind,
        name: detail.resource.name,
        ...(detail.resource.namespace ? { namespace: detail.resource.namespace } : {}),
        status: detail.resource.status,
        health: detail.resource.health,
        conditions: detail.resource.conditions.map((condition) => ({
          ...condition,
          ...(condition.message ? { message: redactSummary(condition.message) } : {}),
        })),
      },
      findings: evaluateDiagnostics(detail.resource),
      eventSummaries:
        includeEvents && this.config.EXTERNAL_ANALYSIS_ALLOW_EVENTS
          ? detail.events
              .map((event) => redactSummary(String(event.properties.message ?? event.status)))
              .slice(0, 50)
          : [],
      metricSummaries:
        includeMetrics && this.config.EXTERNAL_ANALYSIS_ALLOW_METRICS
          ? Object.entries(detail.resource.metrics).map(
              ([key, value]) => `${key}: ${value.value} ${value.unit}`,
            )
          : [],
      constraints: { recommendationOnly: true, noExecution: true },
    });
    await this.queue.add(
      'analyze',
      {
        recommendationId: recommendation.id,
        organizationId,
        request: analysisRequest,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 500,
        removeOnFail: 500,
      },
    );
    return recommendation;
  }

  async feedback(organizationId: string, id: string, helpful: boolean, comment?: string) {
    const recommendation = await this.recommendations.findOneBy({ id, organizationId });
    if (!recommendation) throw new NotFoundException('Recommendation not found');
    recommendation.feedback = { helpful, ...(comment ? { comment: comment.slice(0, 2_000) } : {}) };
    return this.recommendations.save(recommendation);
  }
}

function redactSummary(input: string): string {
  return input
    .replace(/(password|token|secret|api[-_ ]?key)\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 1_000);
}
