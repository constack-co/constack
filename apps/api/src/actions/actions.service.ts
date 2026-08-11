import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AuthorizationV1Api,
  KubeConfig,
  KubernetesObjectApi,
  type KubernetesObject,
} from '@kubernetes/client-node';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { loadRuntimeConfig } from '@constack/config';
import {
  actionPreviewRequestSchema,
  type ActionPreview,
  type ActionPreviewRequest,
  type ActionType,
  type Resource,
} from '@constack/shared-types';
import { RedisService } from '../common/redis.service.js';
import { OperationalAction } from '../persistence/entities.js';
import { TopologyService } from '../topology/topology.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';

interface StoredPreview extends ActionPreview {
  organizationId: string;
  requestedByUserId: string;
  parameters: Record<string, unknown>;
}

const expectedKinds: Record<ActionType, Resource['kind']> = {
  'restart-pod': 'Pod',
  'delete-failed-pod': 'Pod',
  'rollout-restart-deployment': 'Deployment',
  'rollout-restart-statefulset': 'StatefulSet',
  'scale-deployment': 'Deployment',
  'scale-statefulset': 'StatefulSet',
  'retry-job': 'Job',
  'suspend-cronjob': 'CronJob',
  'resume-cronjob': 'CronJob',
};

@Injectable()
export class ActionsService {
  private readonly config = loadRuntimeConfig();
  private readonly queue: Queue;
  private readonly kubeConfig = new KubeConfig();

  constructor(
    @InjectRepository(OperationalAction) private readonly actions: Repository<OperationalAction>,
    private readonly topology: TopologyService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {
    this.queue = new Queue('constack-actions', { connection: redis.client });
    try {
      this.kubeConfig.loadFromDefault();
    } catch {
      /* Permission check reports unavailable. */
    }
  }

  enabled(): boolean {
    return this.config.ACTIONS_ENABLED;
  }

  async preview(
    organizationId: string,
    userId: string,
    input: ActionPreviewRequest,
  ): Promise<ActionPreview> {
    if (!this.enabled()) throw new NotFoundException('Operational actions are not enabled');
    const request = actionPreviewRequestSchema.parse(input);
    const resource = await this.topology.resource(request.resourceId);
    const live = await this.readLiveResource(
      resource.apiVersion,
      resource.kind,
      resource.name,
      resource.namespace,
    );
    if (live.metadata?.uid !== resource.uid)
      throw new ConflictException(
        'The discovered resource no longer matches the live Kubernetes object',
      );
    const liveResourceVersion = live.metadata?.resourceVersion;
    if (!liveResourceVersion)
      throw new ConflictException('Kubernetes did not return a resource version');
    if (resource.kind !== expectedKinds[request.action])
      throw new ConflictException(`${request.action} cannot target ${resource.kind}`);
    if (
      request.action === 'delete-failed-pod' &&
      (live as KubernetesObject & { status?: { phase?: string } }).status?.phase !== 'Failed'
    )
      throw new ConflictException('Only failed Pods can use delete-failed-pod');
    if (request.action.startsWith('scale-') && request.parameters.replicas === undefined)
      throw new ConflictException('A replica count is required');
    const allowed = await this.selfSubjectAllowed(request.action, resource);
    const now = Date.now();
    const preview: StoredPreview = {
      id: crypto.randomUUID(),
      action: request.action,
      target: {
        id: resource.id,
        clusterId: resource.clusterId,
        uid: resource.uid,
        apiVersion: resource.apiVersion,
        kind: resource.kind,
        name: resource.name,
        ...(resource.namespace ? { namespace: resource.namespace } : {}),
      },
      resourceVersion: liveResourceVersion,
      impact: impactFor(request.action, request.parameters.replicas),
      risk: riskFor(request.action),
      operationSummary: operationFor(request.action, resource, request.parameters.replicas),
      allowed,
      ...(!allowed
        ? {
            denialReason:
              'The ConStack action ServiceAccount does not have the required Kubernetes permission.',
          }
        : {}),
      expiresAt: new Date(now + 5 * 60_000).toISOString(),
      organizationId,
      requestedByUserId: userId,
      parameters: request.parameters,
    };
    await this.redis.client.set(
      `action-preview:${preview.id}`,
      JSON.stringify(preview),
      'EX',
      300,
      'NX',
    );
    await this.audit.record({
      organizationId,
      actorUserId: userId,
      eventType: 'action.preview',
      targetId: resource.id,
      outcome: allowed ? 'allowed' : 'denied',
      details: { action: request.action, resourceVersion: preview.resourceVersion },
    });
    return publicPreview(preview);
  }

  async confirm(organizationId: string, userId: string, previewId: string, idempotencyKey: string) {
    if (!this.enabled()) throw new NotFoundException('Operational actions are not enabled');
    if (!idempotencyKey || idempotencyKey.length > 100)
      throw new ConflictException('A valid Idempotency-Key header is required');
    const existing = await this.actions.findOneBy({ idempotencyKey });
    if (existing) return existing;
    const raw = await this.redis.client.getdel(`action-preview:${previewId}`);
    if (!raw) throw new ConflictException('Action preview is missing, expired, or already used');
    const preview = JSON.parse(raw) as StoredPreview;
    if (preview.organizationId !== organizationId || preview.requestedByUserId !== userId)
      throw new ForbiddenException('Action preview belongs to another user or organization');
    if (!preview.allowed) throw new ForbiddenException(preview.denialReason);
    const current = await this.readLiveResource(
      preview.target.apiVersion,
      preview.target.kind,
      preview.target.name,
      preview.target.namespace,
    );
    if (
      current.metadata?.uid !== preview.target.uid ||
      current.metadata?.resourceVersion !== preview.resourceVersion
    )
      throw new ConflictException('The resource changed after preview; create a new preview');
    const action = await this.actions.save(
      this.actions.create({
        organizationId,
        requestedByUserId: userId,
        actionType: preview.action,
        resourceId: preview.target.id,
        status: 'queued',
        parameters: preview.parameters,
        result: null,
        idempotencyKey,
      }),
    );
    await this.queue.add(
      'execute-human-confirmed-action',
      { actionId: action.id, preview },
      { jobId: action.id, attempts: 1, removeOnComplete: 500, removeOnFail: 500 },
    );
    await this.audit.record({
      organizationId,
      actorUserId: userId,
      eventType: 'action.confirm',
      targetId: preview.target.id,
      outcome: 'queued',
      details: { actionId: action.id, action: preview.action },
    });
    return action;
  }

  list(organizationId: string) {
    return this.actions.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async cancel(user: AuthenticatedUser, id: string) {
    const action = await this.actions.findOneBy({ id, organizationId: user.organizationId });
    if (!action) throw new NotFoundException('Action not found');
    if (action.requestedByUserId !== user.id && user.role !== 'administrator')
      throw new ForbiddenException('Only the requester or an administrator may cancel this action');
    if (action.status !== 'queued')
      throw new ConflictException('Only a queued action can be cancelled');
    const job = await this.queue.getJob(action.id);
    if (!job) throw new ConflictException('The queued action is no longer cancellable');
    try {
      await job.remove();
    } catch {
      throw new ConflictException('The action has already started and cannot be cancelled');
    }
    action.status = 'cancelled';
    const saved = await this.actions.save(action);
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      eventType: 'action.cancel',
      targetId: action.resourceId,
      outcome: 'cancelled',
      details: { actionId: action.id, action: action.actionType },
    });
    return saved;
  }

  private async selfSubjectAllowed(action: ActionType, resource: Resource): Promise<boolean> {
    try {
      const api = this.kubeConfig.makeApiClient(AuthorizationV1Api);
      const attributes = permissionFor(action, resource);
      const review = await api.createSubjectAccessReview({
        body: {
          apiVersion: 'authorization.k8s.io/v1',
          kind: 'SubjectAccessReview',
          metadata: {},
          spec: {
            user: `system:serviceaccount:${this.config.POD_NAMESPACE}:${this.config.ACTION_SERVICE_ACCOUNT}`,
            resourceAttributes: attributes,
          },
        },
      });
      return Boolean(review.status?.allowed);
    } catch {
      return false;
    }
  }

  private async readLiveResource(
    apiVersion: string,
    kind: string,
    name: string,
    namespace?: string,
  ): Promise<KubernetesObject> {
    try {
      const api = KubernetesObjectApi.makeApiClient(this.kubeConfig);
      return await api.read({
        apiVersion,
        kind,
        metadata: { name, ...(namespace ? { namespace } : {}) },
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Unable to reread the Kubernetes resource: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}

function permissionFor(action: ActionType, resource: Resource) {
  const group = ['Deployment', 'StatefulSet'].includes(resource.kind)
    ? 'apps'
    : resource.kind === 'Job' || resource.kind === 'CronJob'
      ? 'batch'
      : '';
  const resourceName =
    (
      {
        Pod: 'pods',
        Deployment: 'deployments',
        StatefulSet: 'statefulsets',
        Job: 'jobs',
        CronJob: 'cronjobs',
      } as Record<string, string>
    )[resource.kind] ?? resource.kind.toLowerCase();
  return {
    group,
    version: 'v1',
    resource: resourceName,
    verb: action === 'retry-job' ? 'create' : action.includes('pod') ? 'delete' : 'patch',
    ...(action.startsWith('scale-') ? { subresource: 'scale' } : {}),
    ...(resource.namespace ? { namespace: resource.namespace } : {}),
    ...(action === 'retry-job' ? {} : { name: resource.name }),
  };
}

function publicPreview(preview: StoredPreview): ActionPreview {
  const {
    organizationId: _organizationId,
    requestedByUserId: _userId,
    parameters: _parameters,
    ...result
  } = preview;
  return result;
}

function impactFor(action: ActionType, replicas?: number): string {
  if (action.startsWith('scale-'))
    return `Changes desired replica count to ${replicas}. Capacity and cost may change.`;
  if (action.includes('restart') || action.includes('pod'))
    return 'May temporarily reduce available capacity while Kubernetes replaces workloads.';
  if (action === 'retry-job')
    return 'Creates a new Job execution and may repeat external side effects.';
  return 'Changes future CronJob scheduling behavior.';
}

function riskFor(action: ActionType): ActionPreview['risk'] {
  return action === 'retry-job' || action === 'delete-failed-pod'
    ? 'high'
    : action.startsWith('scale-')
      ? 'medium'
      : 'medium';
}

function operationFor(action: ActionType, resource: Resource, replicas?: number): string {
  return `${action} on ${resource.kind} ${resource.namespace ? `${resource.namespace}/` : ''}${resource.name}${replicas === undefined ? '' : ` with replicas=${replicas}`}`;
}
