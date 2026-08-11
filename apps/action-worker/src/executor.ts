import {
  AppsV1Api,
  AuthorizationV1Api,
  BatchV1Api,
  CoreV1Api,
  KubeConfig,
  PatchStrategy,
  setHeaderOptions,
  type V1Job,
} from '@kubernetes/client-node';
import type { ActionPreview, ActionType } from '@constack/shared-types';

interface StoredPreview extends ActionPreview {
  organizationId: string;
  requestedByUserId: string;
  parameters: { replicas?: number };
}

export class KubernetesActionExecutor {
  private readonly core: CoreV1Api;
  private readonly apps: AppsV1Api;
  private readonly batch: BatchV1Api;
  private readonly authorization: AuthorizationV1Api;

  constructor() {
    const config = new KubeConfig();
    config.loadFromDefault();
    this.core = config.makeApiClient(CoreV1Api);
    this.apps = config.makeApiClient(AppsV1Api);
    this.batch = config.makeApiClient(BatchV1Api);
    this.authorization = config.makeApiClient(AuthorizationV1Api);
  }

  async execute(preview: StoredPreview): Promise<Record<string, unknown>> {
    const { target, action } = preview;
    if (!target.namespace) throw new Error('MVP operational actions require namespaced resources');
    await this.assertAllowed(action, preview);
    await this.assertCurrent(preview);
    switch (action) {
      case 'restart-pod':
      case 'delete-failed-pod':
        await this.core.deleteNamespacedPod({
          name: target.name,
          namespace: target.namespace,
          body: {
            apiVersion: 'v1',
            kind: 'DeleteOptions',
            preconditions: { uid: target.uid, resourceVersion: preview.resourceVersion },
          },
        });
        return { message: `Pod ${target.namespace}/${target.name} deletion accepted.` };
      case 'rollout-restart-deployment':
        await this.apps.patchNamespacedDeployment(
          {
            name: target.name,
            namespace: target.namespace,
            body: restartPatch(preview.resourceVersion),
          },
          patchOptions(PatchStrategy.StrategicMergePatch),
        );
        return {
          message: `Deployment ${target.namespace}/${target.name} rollout restart accepted.`,
        };
      case 'rollout-restart-statefulset':
        await this.apps.patchNamespacedStatefulSet(
          {
            name: target.name,
            namespace: target.namespace,
            body: restartPatch(preview.resourceVersion),
          },
          patchOptions(PatchStrategy.StrategicMergePatch),
        );
        return {
          message: `StatefulSet ${target.namespace}/${target.name} rollout restart accepted.`,
        };
      case 'scale-deployment':
        await this.apps.patchNamespacedDeploymentScale(
          {
            name: target.name,
            namespace: target.namespace,
            body: {
              metadata: { resourceVersion: preview.resourceVersion },
              spec: { replicas: requiredReplicas(preview) },
            },
          },
          patchOptions(PatchStrategy.MergePatch),
        );
        return { message: `Deployment scaled to ${requiredReplicas(preview)}.` };
      case 'scale-statefulset':
        await this.apps.patchNamespacedStatefulSetScale(
          {
            name: target.name,
            namespace: target.namespace,
            body: {
              metadata: { resourceVersion: preview.resourceVersion },
              spec: { replicas: requiredReplicas(preview) },
            },
          },
          patchOptions(PatchStrategy.MergePatch),
        );
        return { message: `StatefulSet scaled to ${requiredReplicas(preview)}.` };
      case 'suspend-cronjob':
      case 'resume-cronjob':
        await this.batch.patchNamespacedCronJob(
          {
            name: target.name,
            namespace: target.namespace,
            body: {
              metadata: { resourceVersion: preview.resourceVersion },
              spec: { suspend: action === 'suspend-cronjob' },
            },
          },
          patchOptions(PatchStrategy.MergePatch),
        );
        return { message: `CronJob ${action === 'suspend-cronjob' ? 'suspended' : 'resumed'}.` };
      case 'retry-job':
        return this.retryJob(preview);
      default:
        return assertNever(action);
    }
  }

  private async assertAllowed(action: ActionType, preview: StoredPreview): Promise<void> {
    const target = preview.target;
    const namespace = target.namespace;
    if (!namespace) throw new Error('Action namespace is required');
    const group = ['Deployment', 'StatefulSet'].includes(target.kind)
      ? 'apps'
      : target.kind === 'Job' || target.kind === 'CronJob'
        ? 'batch'
        : '';
    const resource = (
      {
        Pod: 'pods',
        Deployment: 'deployments',
        StatefulSet: 'statefulsets',
        Job: 'jobs',
        CronJob: 'cronjobs',
      } as Record<string, string>
    )[target.kind];
    if (!resource) throw new Error(`Unsupported action target kind: ${target.kind}`);
    const review = await this.authorization.createSelfSubjectAccessReview({
      body: {
        apiVersion: 'authorization.k8s.io/v1',
        kind: 'SelfSubjectAccessReview',
        metadata: {},
        spec: {
          resourceAttributes: {
            group,
            version: 'v1',
            resource,
            verb: action === 'retry-job' ? 'create' : action.includes('pod') ? 'delete' : 'patch',
            ...(action.startsWith('scale-') ? { subresource: 'scale' } : {}),
            namespace,
            ...(action === 'retry-job' ? {} : { name: target.name }),
          },
        },
      },
    });
    if (!review.status?.allowed)
      throw new Error('Action ServiceAccount no longer has the required permission');
  }

  private async assertCurrent(preview: StoredPreview): Promise<void> {
    const { target } = preview;
    let metadata: { uid?: string; resourceVersion?: string } | undefined;
    if (target.kind === 'Pod')
      metadata = (
        await this.core.readNamespacedPod({ name: target.name, namespace: target.namespace! })
      ).metadata;
    else if (target.kind === 'Deployment')
      metadata = (
        await this.apps.readNamespacedDeployment({
          name: target.name,
          namespace: target.namespace!,
        })
      ).metadata;
    else if (target.kind === 'StatefulSet')
      metadata = (
        await this.apps.readNamespacedStatefulSet({
          name: target.name,
          namespace: target.namespace!,
        })
      ).metadata;
    else if (target.kind === 'Job')
      metadata = (
        await this.batch.readNamespacedJob({ name: target.name, namespace: target.namespace! })
      ).metadata;
    else if (target.kind === 'CronJob')
      metadata = (
        await this.batch.readNamespacedCronJob({ name: target.name, namespace: target.namespace! })
      ).metadata;
    if (metadata?.uid !== target.uid || metadata.resourceVersion !== preview.resourceVersion)
      throw new Error('Resource changed after confirmation; action refused');
  }

  private async retryJob(preview: StoredPreview): Promise<Record<string, unknown>> {
    const namespace = preview.target.namespace;
    if (!namespace) throw new Error('Job namespace is required');
    const original = await this.batch.readNamespacedJob({ name: preview.target.name, namespace });
    if (
      original.metadata?.uid !== preview.target.uid ||
      original.metadata.resourceVersion !== preview.resourceVersion
    )
      throw new Error('Job changed before retry creation; action refused');
    if (!original.spec) throw new Error('Original Job has no spec');
    const name = `${preview.target.name.slice(0, 45)}-retry-${Date.now().toString(36)}`;
    const { selector: _selector, manualSelector: _manualSelector, ...sourceSpec } = original.spec;
    const retrySpec = structuredClone(sourceSpec);
    const templateLabels = retrySpec.template.metadata?.labels;
    if (templateLabels) {
      delete templateLabels['batch.kubernetes.io/controller-uid'];
      delete templateLabels['batch.kubernetes.io/job-name'];
      delete templateLabels['controller-uid'];
      delete templateLabels['job-name'];
    }
    const body: V1Job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name,
        namespace,
        labels: { ...original.metadata?.labels, 'constack.io/retried-from': preview.target.name },
      },
      spec: retrySpec,
    };
    await this.batch.createNamespacedJob({ namespace, body });
    return { message: `Created retry Job ${namespace}/${name}.`, createdJob: name };
  }
}

function restartPatch(resourceVersion: string) {
  return {
    metadata: { resourceVersion },
    spec: {
      template: {
        metadata: {
          annotations: {
            'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
            'constack.io/requested-by': 'human-confirmed-action',
          },
        },
      },
    },
  };
}
function patchOptions(strategy: PatchStrategy) {
  return setHeaderOptions('Content-Type', strategy);
}
function requiredReplicas(preview: StoredPreview): number {
  if (preview.parameters.replicas === undefined) throw new Error('Replica count is missing');
  return preview.parameters.replicas;
}
function assertNever(value: never): never {
  throw new Error(`Unsupported action: ${String(value)}`);
}
export type { StoredPreview };
