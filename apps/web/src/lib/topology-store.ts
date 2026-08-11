import { create } from 'zustand';
import type {
  Position,
  Relationship,
  Resource,
  TopologyPatch,
  TopologySnapshot,
} from '@constack/shared-types';

interface TopologyState {
  clusterId: string;
  sequence: number;
  resources: Record<string, Resource>;
  relationships: Record<string, Relationship>;
  positions: Record<string, Position>;
  selectedIds: string[];
  hoveredId?: string;
  search: string;
  namespace?: string;
  visibleKinds: string[];
  needsResync: boolean;
  navigationActive: boolean;
  focusRequest?: { resourceId: string; nonce: number };
  setSnapshot(snapshot: TopologySnapshot): void;
  applyPatch(patch: TopologyPatch): void;
  select(id: string, additive?: boolean): void;
  setHovered(id?: string): void;
  setSearch(search: string): void;
  setNamespace(namespace?: string): void;
  toggleKind(kind: string): void;
  clearKindFilters(): void;
  updatePositions(positions: Record<string, Position>): void;
  setNavigationActive(active: boolean): void;
  requestFocus(resourceId: string): void;
}

export const useTopologyStore = create<TopologyState>((set) => ({
  clusterId: '',
  sequence: 0,
  resources: {},
  relationships: {},
  positions: {},
  selectedIds: [],
  search: '',
  visibleKinds: [],
  needsResync: false,
  navigationActive: false,
  setSnapshot: (snapshot) =>
    set({
      clusterId: snapshot.clusterId,
      sequence: snapshot.sequence,
      resources: Object.fromEntries(snapshot.resources.map((resource) => [resource.id, resource])),
      relationships: Object.fromEntries(
        snapshot.relationships.map((relationship) => [relationship.id, relationship]),
      ),
      positions: snapshot.positions,
      needsResync: false,
    }),
  applyPatch: (patch) =>
    set((state) => {
      if (state.sequence && patch.sequence !== state.sequence + 1) return { needsResync: true };
      const resources = { ...state.resources };
      const relationships = { ...state.relationships };
      for (const id of patch.removeResourceIds) delete resources[id];
      for (const resource of patch.upsertResources) resources[resource.id] = resource;
      for (const id of patch.removeRelationshipIds) delete relationships[id];
      for (const relationship of patch.upsertRelationships)
        relationships[relationship.id] = relationship;
      return { sequence: patch.sequence, resources, relationships };
    }),
  select: (id, additive = false) =>
    set((state) => ({
      selectedIds: additive
        ? state.selectedIds.includes(id)
          ? state.selectedIds.filter((item) => item !== id)
          : [...state.selectedIds, id]
        : [id],
    })),
  setHovered: (hoveredId) =>
    set((state) => (state.hoveredId === hoveredId ? state : { hoveredId })),
  setSearch: (search) => set({ search }),
  setNamespace: (namespace) => set({ namespace }),
  toggleKind: (kind) =>
    set((state) => ({
      visibleKinds: state.visibleKinds.includes(kind)
        ? state.visibleKinds.filter((item) => item !== kind)
        : [...state.visibleKinds, kind],
    })),
  clearKindFilters: () => set({ visibleKinds: [] }),
  updatePositions: (positions) => set({ positions }),
  setNavigationActive: (navigationActive) =>
    set((state) => (state.navigationActive === navigationActive ? state : { navigationActive })),
  requestFocus: (resourceId) =>
    set((state) => ({ focusRequest: { resourceId, nonce: (state.focusRequest?.nonce ?? 0) + 1 } })),
}));
