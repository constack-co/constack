'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  Clipboard,
  Code2,
  FileText,
  Gauge,
  Info,
  Play,
  RefreshCw,
  ShieldAlert,
  Terminal,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  ActionPreview,
  ActionType,
  Capabilities,
  DiagnosticFinding,
  Relationship,
  Resource,
  UserRole,
} from '@constack/shared-types';
import { api } from '@/lib/api';
import { useTopologyStore } from '@/lib/topology-store';

interface ResourceDetail {
  resource: Resource;
  relationships: Relationship[];
  relatedResources: Resource[];
  diagnostics: DiagnosticFinding[];
  events: Resource[];
}
interface RecommendationRecord {
  id: string;
  resourceId: string;
  status: string;
  result?: RecommendationResult;
  error?: string;
  createdAt: string;
}
interface RecommendationResult {
  summary: string;
  probableCauses: string[];
  evidenceReferences: string[];
  investigationSteps: string[];
  suggestedChanges: string[];
  illustrativeSnippets: Array<{ language: string; title: string; content: string }>;
  risk: string;
  confidence: number;
}
type Tab = 'overview' | 'metrics' | 'diagnostics' | 'recommendations';

export function ResourceInspector({
  capabilities,
  role,
}: {
  capabilities: Capabilities;
  role: UserRole;
}) {
  const selectedId = useTopologyStore((state) => state.selectedIds[0]);
  const select = useTopologyStore((state) => state.select);
  const [tab, setTab] = useState<Tab>('overview');
  const detail = useQuery({
    queryKey: ['resource', selectedId],
    queryFn: () => api<ResourceDetail>(`/resources/${selectedId}`),
    enabled: Boolean(selectedId),
  });
  const resource = detail.data?.resource;
  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div>
          <span className={`health-badge ${resource?.health ?? 'unknown'}`}>
            {resource?.health ?? 'loading'}
          </span>
          <h2>{resource?.name ?? 'Loading…'}</h2>
          <p>
            {resource?.kind}
            {resource?.namespace ? ` · ${resource.namespace}` : ' · cluster-scoped'}
          </p>
        </div>
        <button aria-label="Close details" onClick={() => selectedId && select(selectedId, true)}>
          <X size={18} />
        </button>
      </div>
      <div className="inspector-tabs">
        {(['overview', 'metrics', 'diagnostics', 'recommendations'] as Tab[]).map((item) => (
          <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
            {item === 'recommendations' ? 'Guidance' : item}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {detail.isLoading && (
          <PanelState icon={<RefreshCw className="spin" />} title="Loading resource" />
        )}
        {detail.isError && (
          <PanelState
            icon={<AlertTriangle />}
            title="Resource unavailable"
            description={(detail.error as Error).message}
          />
        )}
        {detail.data && tab === 'overview' && (
          <Overview detail={detail.data} capabilities={capabilities} role={role} />
        )}
        {detail.data && tab === 'metrics' && <Metrics resource={detail.data.resource} />}
        {detail.data && tab === 'diagnostics' && <Diagnostics detail={detail.data} />}
        {detail.data && tab === 'recommendations' && (
          <Recommendations
            resource={detail.data.resource}
            capabilities={capabilities}
            role={role}
          />
        )}
      </div>
    </aside>
  );
}

function Overview({
  detail,
  capabilities,
  role,
}: {
  detail: ResourceDetail;
  capabilities: Capabilities;
  role: UserRole;
}) {
  const resource = detail.resource;
  const select = useTopologyStore((state) => state.select);
  return (
    <>
      <section className="detail-section">
        <h3>Resource</h3>
        <dl className="key-values">
          <dt>Status</dt>
          <dd>{resource.status}</dd>
          <dt>API version</dt>
          <dd>{resource.apiVersion}</dd>
          <dt>Created</dt>
          <dd>{resource.createdAt ? new Date(resource.createdAt).toLocaleString() : 'Unknown'}</dd>
          <dt>Resource version</dt>
          <dd className="mono">{resource.resourceVersion ?? '—'}</dd>
        </dl>
      </section>
      {resource.images.length > 0 && (
        <section className="detail-section">
          <h3>Container images</h3>
          {resource.images.map((image) => (
            <div className="code-row" key={image}>
              <Code2 size={14} />
              <code>{image}</code>
            </div>
          ))}
        </section>
      )}
      <section className="detail-section">
        <h3>
          Relationships <span>{detail.relationships.length}</span>
        </h3>
        {detail.relatedResources.slice(0, 12).map((item) => (
          <button className="related-row" key={item.id} onClick={() => select(item.id)}>
            <span className={`health-dot plain ${item.health}`} />{' '}
            <span>
              <strong>{item.name}</strong>
              <small>{item.kind}</small>
            </span>
            <ChevronRight size={14} />
          </button>
        ))}
        {detail.relatedResources.length === 0 && (
          <p className="muted">No related resources were discovered.</p>
        )}
      </section>
      {Object.keys(resource.labels).length > 0 && (
        <section className="detail-section">
          <h3>Labels</h3>
          <div className="tag-list">
            {Object.entries(resource.labels).map(([key, value]) => (
              <span key={key} title={`${key}=${value}`}>
                {key}={value}
              </span>
            ))}
          </div>
        </section>
      )}
      {capabilities.actions && role !== 'viewer' && <HumanActions resource={resource} />}
    </>
  );
}

function Metrics({ resource }: { resource: Resource }) {
  const metrics = useQuery({
    queryKey: ['metrics', resource.id],
    queryFn: () =>
      api<{ available: boolean; provider?: string; reason?: string; data?: unknown }>(
        `/resources/${resource.id}/metrics`,
      ),
    refetchInterval: 30_000,
  });
  const requested = useMemo(
    () => ({
      desired: resource.properties.desiredReplicas,
      ready: resource.properties.readyReplicas,
      restarts: resource.properties.restartCount,
    }),
    [resource.properties],
  );
  return (
    <>
      <section className="metric-grid">
        <MetricCard label="Desired" value={String(requested.desired ?? '—')} />
        <MetricCard label="Ready" value={String(requested.ready ?? '—')} />
        <MetricCard label="Restarts" value={String(requested.restarts ?? '—')} />
      </section>
      <section className="detail-section">
        <h3>
          <Gauge size={15} />
          Live usage {metrics.data?.provider && <span>{metrics.data.provider}</span>}
        </h3>
        {metrics.isLoading ? (
          <p className="muted">Detecting an in-cluster metrics provider…</p>
        ) : metrics.data?.available ? (
          <LiveMetrics data={metrics.data.data} />
        ) : (
          <PanelState
            icon={<Info />}
            title="Metrics provider unavailable"
            description={metrics.data?.reason ?? 'No live metrics were returned.'}
          />
        )}
      </section>
    </>
  );
}

function LiveMetrics({ data }: { data: unknown }) {
  const record = isRecord(data) ? data : {};
  const values = isRecord(record.values) ? record.values : undefined;
  if (values) {
    const metrics = [
      ['CPU', formatCpu(values.cpuCores)],
      ['Memory', formatBytes(values.memoryBytes)],
      ['Network in', formatRate(values.networkReceiveBytesPerSecond)],
      ['Network out', formatRate(values.networkTransmitBytesPerSecond)],
    ].filter((item): item is [string, string] => Boolean(item[1]));
    return (
      <>
        <div className="live-metric-grid">
          {metrics.map(([label, value]) => (
            <MetricCard key={label} label={label} value={value} />
          ))}
        </div>
        <p className="telemetry-note">
          <span className="live-dot" />
          Observed{' '}
          {typeof record.observedAt === 'string'
            ? new Date(record.observedAt).toLocaleTimeString()
            : 'now'}{' '}
          · read-only telemetry
        </p>
      </>
    );
  }
  const containers = Array.isArray(record.containers) ? record.containers.filter(isRecord) : [];
  if (containers.length)
    return (
      <div className="container-metrics">
        {containers.map((container, index) => {
          const usage = isRecord(container.usage) ? container.usage : {};
          return (
            <article key={String(container.name ?? index)}>
              <strong>{String(container.name ?? `Container ${index + 1}`)}</strong>
              <span>
                CPU <b>{String(usage.cpu ?? '—')}</b>
              </span>
              <span>
                Memory <b>{String(usage.memory ?? '—')}</b>
              </span>
            </article>
          );
        })}
      </div>
    );
  return <pre className="json-block">{JSON.stringify(data, null, 2)}</pre>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function formatCpu(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value < 1
      ? `${Math.round(value * 1_000)}m`
      : `${value.toFixed(2)} cores`
    : undefined;
}
function formatBytes(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let current = value;
  let unit = 0;
  while (current >= 1_024 && unit < units.length - 1) {
    current /= 1_024;
    unit += 1;
  }
  return `${current.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
function formatRate(value: unknown): string | undefined {
  const formatted = formatBytes(value);
  return formatted ? `${formatted}/s` : undefined;
}

function Diagnostics({ detail }: { detail: ResourceDetail }) {
  const [logsOpen, setLogsOpen] = useState(false);
  const logs = useQuery({
    queryKey: ['logs', detail.resource.id],
    queryFn: () => api<{ lines: string[] }>(`/resources/${detail.resource.id}/logs?tailLines=300`),
    enabled: logsOpen && detail.resource.kind === 'Pod',
  });
  return (
    <>
      <section className="detail-section">
        <h3>
          <ShieldAlert size={15} />
          Local diagnostics <span>{detail.diagnostics.length}</span>
        </h3>
        {detail.diagnostics.length ? (
          detail.diagnostics.map((finding) => (
            <article className={`finding ${finding.severity}`} key={finding.id}>
              <div>
                <AlertTriangle size={16} />
                <strong>{finding.title}</strong>
              </div>
              <p>{finding.summary}</p>
              <ol>
                {finding.investigationSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </article>
          ))
        ) : (
          <PanelState
            icon={<Check />}
            title="No active findings"
            description="ConStack's local rules found no current health problems."
          />
        )}
      </section>
      <section className="detail-section">
        <h3>
          <Activity size={15} />
          Kubernetes events <span>{detail.events.length}</span>
        </h3>
        {detail.events.slice(0, 20).map((event) => (
          <div className="event-row" key={event.id}>
            <strong>{String(event.properties.reason ?? event.status)}</strong>
            <p>{String(event.properties.message ?? '')}</p>
          </div>
        ))}
        {detail.events.length === 0 && (
          <p className="muted">No related events are currently retained.</p>
        )}
      </section>
      {detail.resource.kind === 'Pod' && (
        <section className="detail-section">
          <button className="secondary-button wide" onClick={() => setLogsOpen((value) => !value)}>
            <Terminal size={15} />
            {logsOpen ? 'Hide pod logs' : 'Load pod logs'}
          </button>
          {logsOpen &&
            (logs.isLoading ? (
              <p className="muted">Loading logs…</p>
            ) : logs.isError ? (
              <p className="error-text">{(logs.error as Error).message}</p>
            ) : (
              <pre className="log-view">{logs.data?.lines.join('\n')}</pre>
            ))}
        </section>
      )}
    </>
  );
}

function Recommendations({
  resource,
  capabilities,
  role,
}: {
  resource: Resource;
  capabilities: Capabilities;
  role: UserRole;
}) {
  const queryClient = useQueryClient();
  const [includeEvents, setIncludeEvents] = useState(false);
  const [includeMetrics, setIncludeMetrics] = useState(false);
  const recommendations = useQuery({
    queryKey: ['recommendations', resource.id],
    queryFn: () =>
      api<RecommendationRecord[]>(`/recommendations?resourceId=${encodeURIComponent(resource.id)}`),
    refetchInterval: 10_000,
    enabled: capabilities.externalAnalysis,
  });
  const analyze = useMutation({
    mutationFn: () =>
      api('/recommendations/analyze', {
        method: 'POST',
        body: JSON.stringify({ resourceId: resource.id, includeEvents, includeMetrics }),
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['recommendations', resource.id] }),
  });
  return (
    <>
      <div className="safety-callout">
        <Bot size={18} />
        <div>
          <strong>Recommendation only</strong>
          <p>
            External analysis cannot execute, prepare, or prefill an operational action. Apply
            guidance manually through your GitOps or release workflow.
          </p>
        </div>
      </div>
      {!capabilities.externalAnalysis ? (
        <PanelState
          icon={<FileText />}
          title="External analysis is disabled"
          description="Local diagnostics remain available. An administrator can configure a generic recommendation endpoint if company policy permits it."
        />
      ) : (
        <section className="detail-section">
          <h3>Context leaving ConStack</h3>
          <ul className="context-list">
            <li>
              <Check size={13} />
              Sanitized resource status and conditions
            </li>
            <li>
              <Check size={13} />
              Local diagnostic findings
            </li>
            <li>
              {capabilities.externalAnalysisContext.eventSummaries ? (
                <label>
                  <input
                    type="checkbox"
                    checked={includeEvents}
                    onChange={(event) => setIncludeEvents(event.target.checked)}
                  />
                  Sanitized event summaries
                </label>
              ) : (
                <>
                  <X size={13} />
                  Event summaries are not permitted by the administrator
                </>
              )}
            </li>
            <li>
              {capabilities.externalAnalysisContext.metricSummaries ? (
                <label>
                  <input
                    type="checkbox"
                    checked={includeMetrics}
                    onChange={(event) => setIncludeMetrics(event.target.checked)}
                  />
                  Selected metric summaries
                </label>
              ) : (
                <>
                  <X size={13} />
                  Metric summaries are not permitted by the administrator
                </>
              )}
            </li>
            <li>
              <X size={13} />
              No raw logs, manifests, annotations, or environment values
            </li>
          </ul>
          {role !== 'viewer' && (
            <button
              className="primary-button wide"
              disabled={analyze.isPending}
              onClick={() => analyze.mutate()}
            >
              <Bot size={15} />
              {analyze.isPending ? 'Requesting analysis…' : 'Generate recommendation'}
            </button>
          )}
        </section>
      )}
      {capabilities.externalAnalysis && (
        <section className="detail-section">
          <h3>Recommendations</h3>
          {recommendations.data?.map((item) => (
            <RecommendationCard key={item.id} item={item} />
          ))}
          {!recommendations.data?.length && (
            <p className="muted">
              No external recommendations have been generated for this resource.
            </p>
          )}
        </section>
      )}
    </>
  );
}

function RecommendationCard({ item }: { item: RecommendationRecord }) {
  if (item.status !== 'completed' || !item.result)
    return (
      <article className="recommendation-card">
        <span className={`status-line ${item.status}`}>{item.status}</span>
        <p>{item.error ?? 'The recommendation is being generated.'}</p>
      </article>
    );
  const result = item.result;
  return (
    <article className="recommendation-card">
      <div className="recommendation-meta">
        <span>Risk: {result.risk}</span>
        <span>{Math.round(result.confidence * 100)}% confidence</span>
      </div>
      <h4>{result.summary}</h4>
      {result.probableCauses.length > 0 && (
        <>
          <h5>Probable causes</h5>
          <ul>
            {result.probableCauses.map((cause) => (
              <li key={cause}>{cause}</li>
            ))}
          </ul>
        </>
      )}
      {result.investigationSteps.length > 0 && (
        <>
          <h5>Investigation</h5>
          <ol>
            {result.investigationSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </>
      )}
      {result.suggestedChanges.length > 0 && (
        <>
          <h5>Suggested manual changes</h5>
          <ul>
            {result.suggestedChanges.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </>
      )}
      {result.illustrativeSnippets.map((snippet) => (
        <div className="snippet" key={snippet.title}>
          <div>
            <span>{snippet.title}</span>
            <button
              aria-label="Copy illustrative snippet"
              onClick={() => navigator.clipboard.writeText(snippet.content)}
            >
              <Clipboard size={13} />
            </button>
          </div>
          <pre>{snippet.content}</pre>
        </div>
      ))}
      <div className="manual-only">
        <Info size={13} />
        Illustrative only. Review and apply through your normal engineering workflow.
      </div>
    </article>
  );
}

function HumanActions({ resource }: { resource: Resource }) {
  const actions = allowedActions(resource);
  const [action, setAction] = useState<ActionType | ''>('');
  const [replicas, setReplicas] = useState(Number(resource.properties.desiredReplicas ?? 1));
  const [preview, setPreview] = useState<ActionPreview>();
  const previewMutation = useMutation({
    mutationFn: () =>
      api<ActionPreview>('/actions/previews', {
        method: 'POST',
        body: JSON.stringify({
          action,
          resourceId: resource.id,
          parameters: action.startsWith('scale-') ? { replicas } : {},
        }),
      }),
    onSuccess: setPreview,
  });
  const confirm = useMutation({
    mutationFn: () =>
      api(`/actions/${preview!.id}/confirm`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
    onSuccess: () => {
      setPreview(undefined);
      setAction('');
    },
  });
  if (!actions.length) return null;
  return (
    <section className="detail-section action-zone">
      <h3>
        <Play size={14} />
        Human-operated action
      </h3>
      <p className="muted">
        Actions are independent of recommendations and always require preview and confirmation.
      </p>
      <select
        value={action}
        onChange={(event) => {
          setAction(event.target.value as ActionType);
          setPreview(undefined);
        }}
      >
        <option value="">Choose an action…</option>
        {actions.map((item) => (
          <option key={item} value={item}>
            {item.replaceAll('-', ' ')}
          </option>
        ))}
      </select>
      {action.startsWith('scale-') && (
        <label>
          Replicas
          <input
            type="number"
            min={0}
            max={10000}
            value={replicas}
            onChange={(event) => setReplicas(Number(event.target.value))}
          />
        </label>
      )}
      <button
        className="secondary-button wide"
        disabled={!action || previewMutation.isPending}
        onClick={() => previewMutation.mutate()}
      >
        Preview exact operation
      </button>
      {preview && (
        <div className="confirmation">
          <strong>{preview.operationSummary}</strong>
          <p>{preview.impact}</p>
          <span>
            Risk: {preview.risk} · Expires {new Date(preview.expiresAt).toLocaleTimeString()}
          </span>
          {preview.allowed ? (
            <button
              className="danger-button"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              {confirm.isPending ? 'Submitting…' : 'Confirm operation'}
            </button>
          ) : (
            <p className="error-text">{preview.denialReason}</p>
          )}
        </div>
      )}
    </section>
  );
}

function allowedActions(resource: Resource): ActionType[] {
  if (resource.kind === 'Pod')
    return resource.status === 'Failed' ? ['delete-failed-pod', 'restart-pod'] : ['restart-pod'];
  if (resource.kind === 'Deployment') return ['rollout-restart-deployment', 'scale-deployment'];
  if (resource.kind === 'StatefulSet') return ['rollout-restart-statefulset', 'scale-statefulset'];
  if (resource.kind === 'Job') return ['retry-job'];
  if (resource.kind === 'CronJob') return ['suspend-cronjob', 'resume-cronjob'];
  return [];
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function PanelState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="panel-state">
      <span>{icon}</span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}
