'use client';

import dynamic from 'next/dynamic';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  Check,
  Layers3,
  LogOut,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Capabilities, TopologySnapshot } from '@constack/shared-types';
import type { LayoutMode } from '@constack/topology-engine';
import type { SessionResponse } from '@/lib/api';
import { api } from '@/lib/api';
import { useTopologyStore } from '@/lib/topology-store';
import {
  defaultTopologyLayers,
  isTopologyResourceVisible,
  type TopologyLayer,
} from '@/lib/topology-visibility';
import { getAttentionItems } from '@/lib/attention';
import { useRealtime } from '@/lib/use-realtime';
import { ResourceSidebar } from './resource-sidebar';
import { ResourceInspector } from './resource-inspector';

const TopologyCanvas = dynamic(
  () => import('./topology-canvas').then((module) => module.TopologyCanvas),
  { ssr: false, loading: () => <div className="canvas-loading">Initializing WebGL scene…</div> },
);

const layerOptions: Array<{ id: TopologyLayer; label: string; description: string }> = [
  {
    id: 'workloads',
    label: 'Applications and services',
    description: 'Ingress, services, controllers and classified data systems',
  },
  { id: 'replicas', label: 'Pods and replicas', description: 'ReplicaSets and individual Pods' },
  {
    id: 'nodes',
    label: 'Nodes and scheduling',
    description: 'Cluster, namespace and node infrastructure',
  },
  {
    id: 'storage',
    label: 'Persistent storage',
    description: 'Claims, volumes and storage classes',
  },
  {
    id: 'configuration',
    label: 'Configuration',
    description: 'Endpoints, ConfigMaps, autoscalers and service accounts',
  },
  {
    id: 'security',
    label: 'Security policies',
    description: 'Network policies and their governed resources',
  },
  {
    id: 'traffic',
    label: 'Observed traffic',
    description: 'Measured request paths from a detected telemetry provider',
  },
];

export function Dashboard({ session }: { session: SessionResponse }) {
  const [layout, setLayout] = useState<LayoutMode>('cluster');
  const [topologyLayers, setTopologyLayers] = useState<TopologyLayer[]>([...defaultTopologyLayers]);
  const [layersOpen, setLayersOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [cameraCommand, setCameraCommand] = useState<{
    type: 'reset' | 'fit';
    nonce: number;
  } | null>(null);
  const setSnapshot = useTopologyStore((state) => state.setSnapshot);
  const updatePositions = useTopologyStore((state) => state.updatePositions);
  const search = useTopologyStore((state) => state.search);
  const setSearch = useTopologyStore((state) => state.setSearch);
  const namespace = useTopologyStore((state) => state.namespace);
  const visibleKinds = useTopologyStore((state) => state.visibleKinds);
  const resourceMap = useTopologyStore((state) => state.resources);
  const relationshipMap = useTopologyStore((state) => state.relationships);
  const selectedIds = useTopologyStore((state) => state.selectedIds);
  const select = useTopologyStore((state) => state.select);
  const requestFocus = useTopologyStore((state) => state.requestFocus);
  const queryClient = useQueryClient();
  const worker = useRef<Worker | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const snapshot = useQuery({
    queryKey: ['topology', layout],
    queryFn: () => api<TopologySnapshot>(`/topology?layout=${layout}`),
    refetchInterval: 60_000,
  });
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api<Capabilities>('/capabilities'),
  });
  const resources = useMemo(() => Object.values(resourceMap), [resourceMap]);
  const sceneResources = useMemo(
    () =>
      resources.filter((resource) =>
        isTopologyResourceVisible(
          resource,
          topologyLayers,
          search.toLocaleLowerCase(),
          namespace,
          visibleKinds,
        ),
      ),
    [namespace, resources, search, topologyLayers, visibleKinds],
  );
  const observedEdges = useMemo(
    () =>
      Object.values(relationshipMap).filter(
        (edge) => edge.type === 'traffic' || edge.type === 'trace',
      ).length,
    [relationshipMap],
  );
  const trafficAvailable = Boolean(
    capabilities.data?.telemetry?.traffic.available || observedEdges > 0,
  );
  const resyncTopology = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ['topology'] }),
    [queryClient],
  );

  useEffect(() => {
    if (snapshot.data) setSnapshot(snapshot.data);
  }, [setSnapshot, snapshot.data]);
  useEffect(() => {
    worker.current = new Worker(new URL('../lib/layout.worker.ts', import.meta.url));
    worker.current.onmessage = (
      event: MessageEvent<Record<string, { x: number; y: number; z: number }>>,
    ) => updatePositions(event.data);
    return () => worker.current?.terminate();
  }, [updatePositions]);
  useEffect(() => {
    worker.current?.postMessage({ resources: sceneResources, mode: layout });
  }, [layout, sceneResources]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key === 'Escape') {
        if (document.activeElement === searchInput.current) {
          setSearch('');
          searchInput.current?.blur();
        }
        setSettingsOpen(false);
        setAttentionOpen(false);
        setLayersOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setSearch]);

  useRealtime(resyncTopology);
  const attentionItems = useMemo(() => getAttentionItems(resources), [resources]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  }
  function refreshClusterData() {
    void queryClient.invalidateQueries({ queryKey: ['topology'] });
    void queryClient.invalidateQueries({ queryKey: ['capabilities'] });
  }
  function toggleTopologyLayer(layer: TopologyLayer) {
    if (layer === 'workloads') return;
    setTopologyLayers((current) =>
      current.includes(layer) ? current.filter((item) => item !== layer) : [...current, layer],
    );
  }

  return (
    <main className="console-shell">
      <header className="topbar">
        <div className="brand compact">
          <span className="brand-mark brand-mark-logo">
            <img src="/brand/constack-logo.png" alt="" draggable={false} />
          </span>
          <span>CONSTACK</span>
        </div>
        <div
          className="cluster-switcher"
          title="This MVP observes the cluster where ConStack is installed"
        >
          <span className="live-dot" />
          in-cluster
        </div>
        <div className="global-search">
          <Search size={16} />
          <input
            ref={searchInput}
            aria-label="Search resources"
            placeholder="Search resources…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <kbd>⌘ K</kbd>
        </div>
        <div className="topbar-actions">
          <span className="status-pill">
            <Activity size={14} />
            {resources.length} resources
          </span>
          {attentionItems.length > 0 && (
            <button
              className={`status-pill warning attention-trigger ${attentionOpen ? 'active' : ''}`}
              aria-label={`Open ${attentionItems.length} resources needing attention`}
              aria-expanded={attentionOpen}
              onClick={() => {
                setAttentionOpen((value) => !value);
                setSettingsOpen(false);
              }}
            >
              <Bell size={14} />
              {attentionItems.length} need attention
            </button>
          )}
          <button
            className={settingsOpen ? 'active' : ''}
            aria-label="Open installation settings"
            aria-expanded={settingsOpen}
            onClick={() => {
              setSettingsOpen((value) => !value);
              setAttentionOpen(false);
            }}
          >
            <Settings2 size={17} />
          </button>
          <span className="user-chip" title={`${session.user.displayName} — ${session.user.role}`}>
            {session.user.displayName.slice(0, 2).toUpperCase()}
          </span>
          <button aria-label="Log out" onClick={logout}>
            <LogOut size={17} />
          </button>
        </div>
        {attentionOpen && (
          <aside className="attention-popover" aria-label="Resources needing attention">
            <header>
              <div>
                <span className="eyebrow">ACTIVE HEALTH</span>
                <strong>Needs attention</strong>
                <p>
                  {attentionItems.length} workload{' '}
                  {attentionItems.length === 1 ? 'item requires' : 'items require'} review
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Close attention list"
                onClick={() => setAttentionOpen(false)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="attention-list">
              {attentionItems.map((item) => (
                <button
                  key={item.resource.id}
                  onClick={() => {
                    select(item.resource.id);
                    requestFocus(item.resource.id);
                    setAttentionOpen(false);
                  }}
                >
                  <span className={`attention-severity ${item.severity}`} />
                  <span>
                    <strong>{item.resource.name}</strong>
                    <small>
                      {item.resource.kind} · {item.resource.namespace ?? 'cluster scoped'}
                    </small>
                    <em>{item.reason}</em>
                  </span>
                </button>
              ))}
            </div>
            <footer>
              Derived from live Kubernetes status, container state, and rollout readiness.
            </footer>
          </aside>
        )}
        {settingsOpen && (
          <aside className="settings-popover" aria-label="Installation settings">
            <header>
              <div>
                <span className="eyebrow">INSTALLATION</span>
                <strong>ConStack runtime</strong>
              </div>
              <button
                className="icon-button"
                aria-label="Close installation settings"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={16} />
              </button>
            </header>
            <dl>
              <dt>Cluster</dt>
              <dd>
                <span className="live-dot" />
                in-cluster
              </dd>
              <dt>Signed in as</dt>
              <dd>{session.user.email}</dd>
              <dt>Role</dt>
              <dd>{session.user.role}</dd>
              <dt>Telemetry</dt>
              <dd>
                {capabilities.data?.telemetry?.providers.length
                  ? capabilities.data.telemetry.providers
                      .map((provider) => provider.name)
                      .join(', ')
                  : 'No provider detected'}
              </dd>
              <dt>Operational actions</dt>
              <dd>
                {capabilities.data?.actions ? (
                  <>
                    <Check size={13} />
                    Enabled
                  </>
                ) : (
                  'Disabled'
                )}
              </dd>
              <dt>External analysis</dt>
              <dd>
                {capabilities.data?.externalAnalysis ? (
                  <>
                    <Check size={13} />
                    Enabled
                  </>
                ) : (
                  'Disabled'
                )}
              </dd>
              <dt>Secret metadata</dt>
              <dd>{capabilities.data?.secretMetadataDiscovery ? 'Enabled' : 'Disabled'}</dd>
            </dl>
            <div className="settings-safety">
              <ShieldCheck size={17} />
              <p>
                Discovery and telemetry access are read-only. Optional actions and external analysis
                remain independently feature-gated.
              </p>
            </div>
            <button className="secondary-button wide" onClick={refreshClusterData}>
              <RefreshCw size={15} />
              Refresh cluster data
            </button>
          </aside>
        )}
      </header>
      <section className="workspace">
        {sidebarOpen && <ResourceSidebar />}
        <div className="scene-column">
          <div className="scene-toolbar">
            <button
              className="ghost-button"
              onClick={() => setSidebarOpen((value) => !value)}
              title={sidebarOpen ? 'Hide resource inventory' : 'Show resource inventory'}
            >
              {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
              {sidebarOpen ? 'Hide inventory' : 'Show inventory'}
            </button>
            <button
              className={`ghost-button topology-detail ${layersOpen ? 'active' : ''}`}
              onClick={() => setLayersOpen((value) => !value)}
              aria-expanded={layersOpen}
              title="Choose progressive topology layers"
            >
              <Layers3 size={14} />
              Layers {topologyLayers.length}
              <span className="toolbar-count">{sceneResources.length}</span>
            </button>
            {layersOpen && (
              <aside className="layers-popover" aria-label="Topology layers">
                <header>
                  <div>
                    <span className="eyebrow">TOPOLOGY</span>
                    <strong>Visible layers</strong>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Close topology layers"
                    onClick={() => setLayersOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </header>
                <div className="layer-presets">
                  <button onClick={() => setTopologyLayers(['workloads'])}>Application map</button>
                  <button
                    onClick={() => setTopologyLayers(['workloads', 'replicas', 'nodes', 'storage'])}
                  >
                    Infrastructure
                  </button>
                  <button
                    onClick={() =>
                      setTopologyLayers(
                        layerOptions
                          .filter((item) => item.id !== 'traffic' || trafficAvailable)
                          .map((item) => item.id),
                      )
                    }
                  >
                    Show available
                  </button>
                </div>
                <div className="layer-list">
                  {layerOptions.map((option) => {
                    const active = topologyLayers.includes(option.id);
                    const unavailable = option.id === 'traffic' && !trafficAvailable;
                    return (
                      <button
                        key={option.id}
                        className={active ? 'active' : ''}
                        disabled={option.id === 'workloads' || unavailable}
                        aria-pressed={active}
                        onClick={() => toggleTopologyLayer(option.id)}
                      >
                        <span className="layer-check">{active && <Check size={13} />}</span>
                        <span>
                          <strong>{option.label}</strong>
                          <small>
                            {unavailable
                              ? (capabilities.data?.telemetry?.traffic.reason ??
                                'No compatible traffic telemetry was detected')
                              : option.description}
                          </small>
                        </span>
                        {unavailable && <em>Unavailable</em>}
                      </button>
                    );
                  })}
                </div>
                <footer>
                  Layers change presentation only. ConStack discovery remains read-only.
                </footer>
              </aside>
            )}
            <div className="view-tabs" role="tablist">
              {(
                [
                  'cluster',
                  'namespace',
                  'application',
                  'service',
                  'node',
                  'incident',
                  'trace',
                ] as LayoutMode[]
              ).map((mode) => (
                <button
                  key={mode}
                  className={layout === mode ? 'active' : ''}
                  onClick={() => setLayout(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <button
              className="ghost-button"
              onClick={() => setCameraCommand({ type: 'fit', nonce: Date.now() })}
              title="Fit visible resources"
            >
              <Maximize2 size={14} />
              Fit
            </button>
            <button
              className="ghost-button"
              onClick={() => setCameraCommand({ type: 'reset', nonce: Date.now() })}
              title="Reset camera"
            >
              <RotateCcw size={14} />
              Reset
            </button>
            <div className="scene-hint">Double-click to focus · Shift-click to multi-select</div>
          </div>
          <div className="scene-frame">
            {layout === 'incident' || layout === 'trace' ? (
              <div className="canvas-loading">
                <div>
                  <strong>
                    {layout === 'incident'
                      ? 'Incident topology unavailable'
                      : 'Trace topology unavailable'}
                  </strong>
                  <p>
                    {layout === 'incident'
                      ? 'No incident relationship data is attached to the current topology.'
                      : (capabilities.data?.telemetry?.traces.reason ??
                        'No trace provider is configured. Kubernetes discovery continues normally.')}
                  </p>
                </div>
              </div>
            ) : (
              <TopologyCanvas
                cameraCommand={cameraCommand}
                layers={topologyLayers}
                layout={layout}
              />
            )}
            <div className="topology-legend">
              <strong>Relationship data</strong>
              <span>
                <i className="configured" />
                Configured routes
              </span>
              <span className={trafficAvailable ? '' : 'unavailable'}>
                <i className="observed" />
                Observed traffic{' '}
                <em>{trafficAvailable ? `${observedEdges} paths` : 'not detected'}</em>
              </span>
            </div>
          </div>
        </div>
        {selectedIds.length > 0 && (
          <ResourceInspector
            capabilities={
              capabilities.data ?? {
                actions: false,
                externalAnalysis: false,
                secretMetadataDiscovery: false,
                metrics: false,
                externalAnalysisContext: {
                  resourceSummary: false,
                  localFindings: false,
                  eventSummaries: false,
                  metricSummaries: false,
                },
              }
            }
            role={session.user.role}
          />
        )}
      </section>
    </main>
  );
}
