'use client';

import { Boxes, Check, ChevronRight, CircleDot, Filter, Layers3, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Resource } from '@constack/shared-types';
import { useTopologyStore } from '@/lib/topology-store';

const healthLabel: Record<Resource['health'], string> = {
  healthy: 'Healthy',
  progressing: 'Progressing',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
  unknown: 'Unknown',
};

export function ResourceSidebar() {
  const resourceMap = useTopologyStore((state) => state.resources);
  const search = useTopologyStore((state) => state.search.toLocaleLowerCase());
  const namespace = useTopologyStore((state) => state.namespace);
  const setNamespace = useTopologyStore((state) => state.setNamespace);
  const visibleKinds = useTopologyStore((state) => state.visibleKinds);
  const toggleKind = useTopologyStore((state) => state.toggleKind);
  const clearKindFilters = useTopologyStore((state) => state.clearKindFilters);
  const selected = useTopologyStore((state) => state.selectedIds);
  const select = useTopologyStore((state) => state.select);
  const [filterOpen, setFilterOpen] = useState(false);
  const all = useMemo(() => Object.values(resourceMap), [resourceMap]);
  const resources = useMemo(
    () =>
      all.filter(
        (item) =>
          (!search ||
            `${item.kind} ${item.name} ${item.namespace ?? ''} ${item.health} ${item.status}`
              .toLocaleLowerCase()
              .includes(search)) &&
          (!namespace || item.namespace === namespace) &&
          (!visibleKinds.length || visibleKinds.includes(item.kind)),
      ),
    [all, namespace, search, visibleKinds],
  );
  const namespaces = useMemo(
    () =>
      [
        ...new Set(
          all.map((item) => item.namespace).filter((item): item is string => Boolean(item)),
        ),
      ].sort(),
    [all],
  );
  const kinds = useMemo(
    () =>
      [
        ...new Set(
          all.filter((item) => !namespace || item.namespace === namespace).map((item) => item.kind),
        ),
      ].sort(),
    [all, namespace],
  );
  const groups = useMemo(
    () =>
      Object.entries(Object.groupBy(resources, (resource) => resource.kind)).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    [resources],
  );

  return (
    <aside className="resource-sidebar">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">INVENTORY</span>
          <h2>Resources</h2>
        </div>
        <button
          className={`icon-button ${filterOpen || visibleKinds.length ? 'active' : ''}`}
          aria-label="Filter resource kinds"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((value) => !value)}
        >
          <Filter size={16} />
          {visibleKinds.length > 0 && <span>{visibleKinds.length}</span>}
        </button>
      </div>
      <label className="select-label">
        Namespace
        <select
          value={namespace ?? ''}
          onChange={(event) => setNamespace(event.target.value || undefined)}
        >
          <option value="">All namespaces</option>
          {namespaces.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      {filterOpen && (
        <section className="filter-panel" aria-label="Resource kind filters">
          <div>
            <strong>Resource kinds</strong>
            <button
              className="icon-button"
              aria-label="Close filters"
              onClick={() => setFilterOpen(false)}
            >
              <X size={15} />
            </button>
          </div>
          <p>
            {visibleKinds.length
              ? `${visibleKinds.length} kinds selected`
              : 'All kinds are visible'}
          </p>
          <div className="kind-filter-grid">
            {kinds.map((kind) => {
              const active = visibleKinds.includes(kind);
              return (
                <button
                  key={kind}
                  className={active ? 'active' : ''}
                  onClick={() => toggleKind(kind)}
                >
                  <span>{active && <Check size={12} />}</span>
                  {kind}
                </button>
              );
            })}
          </div>
          {visibleKinds.length > 0 && (
            <button className="secondary-button wide" onClick={clearKindFilters}>
              Show all kinds
            </button>
          )}
        </section>
      )}
      <div className="inventory-summary">
        <span>
          <Boxes size={15} />
          {resources.length} visible
        </span>
        <span>
          <Layers3 size={15} />
          {groups.length} kinds
        </span>
      </div>
      <div className="resource-groups">
        {groups.map(([kind, items]) => (
          <div className="resource-group" key={kind}>
            <div className="resource-group-title">
              <span>{kind}</span>
              <span>{items?.length ?? 0}</span>
            </div>
            {items?.slice(0, 250).map((resource) => (
              <button
                key={resource.id}
                className={`resource-row ${selected.includes(resource.id) ? 'selected' : ''}`}
                onClick={(event) => select(resource.id, event.shiftKey)}
              >
                <span
                  className={`health-dot ${resource.health}`}
                  title={healthLabel[resource.health]}
                >
                  <CircleDot size={12} />
                </span>
                <span className="resource-name">
                  <strong>{resource.name}</strong>
                  <small>
                    {resource.namespace ?? 'cluster-scoped'} · {resource.status}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
