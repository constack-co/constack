'use client';

import { Html, Line, OrbitControls, PerspectiveCamera, Stars, useGLTF } from '@react-three/drei';
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { assetFor, assetForResource, type AssetDefinition } from '@constack/three-assets';
import type {
  Position,
  Relationship,
  Resource,
  ResourceKind,
  RelationshipType,
} from '@constack/shared-types';
import type { LayoutMode } from '@constack/topology-engine';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useTopologyStore } from '@/lib/topology-store';
import { isTopologyResourceVisible, type TopologyLayer } from '@/lib/topology-visibility';

useGLTF.setDecoderPath('/draco/');

const defaultCameraPosition: [number, number, number] = [42, 32, 58];
const defaultCameraTarget: [number, number, number] = [0, 1.8, 0];

export function TopologyCanvas({
  cameraCommand,
  layers,
  layout,
}: {
  cameraCommand: { type: 'reset' | 'fit'; nonce: number } | null;
  layers: TopologyLayer[];
  layout: LayoutMode;
}) {
  const [supported, setSupported] = useState(true);
  const [availableModels, setAvailableModels] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      setSupported(Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')));
    } catch {
      setSupported(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    void fetch('/models/manifest.json')
      .then((response) => (response.ok ? response.json() : { models: [] }))
      .then((manifest: { models?: unknown }) => {
        if (active)
          setAvailableModels(
            new Set(
              Array.isArray(manifest.models)
                ? manifest.models.filter((item): item is string => typeof item === 'string')
                : [],
            ),
          );
      })
      .catch(() => {
        if (active) setAvailableModels(new Set());
      });
    return () => {
      active = false;
    };
  }, []);
  if (!supported)
    return (
      <div className="webgl-fallback">
        <h3>3D rendering unavailable</h3>
        <p>Use the inventory and details panels to inspect this cluster.</p>
      </div>
    );
  return (
    <Canvas
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
      onPointerMissed={() => useTopologyStore.setState({ selectedIds: [] })}
    >
      <color attach="background" args={['#070b12']} />
      <fog attach="fog" args={['#070b12', 65, 180]} />
      <PerspectiveCamera
        makeDefault
        position={defaultCameraPosition}
        fov={46}
        near={0.1}
        far={500}
      />
      <ambientLight intensity={0.72} />
      <directionalLight position={[24, 40, 15]} intensity={2.2} color="#dcecff" />
      <pointLight position={[-30, 15, -20]} intensity={60} color="#0ea5e9" distance={100} />
      <Stars radius={150} depth={50} count={900} factor={2} saturation={0} fade speed={0.25} />
      <Grid />
      <GroupRegions layers={layers} layout={layout} />
      <ResourceInstances availableModels={availableModels} layers={layers} />
      <ConnectionLines layers={layers} />
      <OrbitControls
        makeDefault
        target={defaultCameraTarget}
        enableDamping
        dampingFactor={0.055}
        rotateSpeed={0.65}
        zoomSpeed={0.85}
        panSpeed={0.75}
        screenSpacePanning={false}
        minDistance={8}
        maxDistance={190}
        maxPolarAngle={Math.PI * 0.48}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        onStart={() => {
          const state = useTopologyStore.getState();
          state.setNavigationActive(true);
          state.setHovered(undefined);
        }}
        onEnd={() => useTopologyStore.getState().setNavigationActive(false)}
      />
      <CameraRig command={cameraCommand} />
    </Canvas>
  );
}

function Grid() {
  return <gridHelper args={[240, 60, '#18263b', '#111a28']} position={[0, -0.1, 0]} />;
}

function GroupRegions({ layers, layout }: { layers: TopologyLayer[]; layout: LayoutMode }) {
  const resourceMap = useTopologyStore((state) => state.resources);
  const positions = useTopologyStore((state) => state.positions);
  const search = useTopologyStore((state) => state.search.toLocaleLowerCase());
  const namespace = useTopologyStore((state) => state.namespace);
  const visibleKinds = useTopologyStore((state) => state.visibleKinds);
  const regions = useMemo(() => {
    const visible = Object.values(resourceMap).filter((resource) =>
      isTopologyResourceVisible(resource, layers, search, namespace, visibleKinds),
    );
    const grouped = Object.groupBy(visible, (resource) => topologyGroupKey(resource, layout));
    return Object.entries(grouped).flatMap(([name, resources]) => {
      const items = (resources ?? []).filter((resource) => positions[resource.id]);
      if (!items.length) return [];
      const xs = items.map((resource) => positions[resource.id]!.x);
      const zs = items.map((resource) => positions[resource.id]!.z);
      const minX = Math.min(...xs) - 4.4;
      const maxX = Math.max(...xs) + 4.4;
      const minZ = Math.min(...zs) - 4.4;
      const maxZ = Math.max(...zs) + 4.4;
      return [{ name, items, minX, maxX, minZ, maxZ, color: groupColor(name) }];
    });
  }, [layers, layout, namespace, positions, resourceMap, search, visibleKinds]);

  return (
    <>
      {regions.map((region) => {
        const width = Math.max(14, region.maxX - region.minX);
        const depth = Math.max(14, region.maxZ - region.minZ);
        const centerX = (region.minX + region.maxX) / 2;
        const centerZ = (region.minZ + region.maxZ) / 2;
        const unhealthy = region.items.filter(
          (item) => item.health === 'unhealthy' || item.health === 'degraded',
        ).length;
        const border: Array<[number, number, number]> = [
          [region.minX, 0.12, region.minZ],
          [region.maxX, 0.12, region.minZ],
          [region.maxX, 0.12, region.maxZ],
          [region.minX, 0.12, region.maxZ],
          [region.minX, 0.12, region.minZ],
        ];
        return (
          <group key={region.name}>
            <mesh position={[centerX, 0, centerZ]} receiveShadow>
              <boxGeometry args={[width, 0.18, depth]} />
              <meshStandardMaterial
                color={region.color}
                transparent
                opacity={0.1}
                roughness={0.92}
                metalness={0.08}
                depthWrite={false}
              />
            </mesh>
            <Line
              points={border}
              color={region.color}
              transparent
              opacity={0.72}
              lineWidth={1.25}
            />
            <Html position={[region.minX + 1, 0.42, region.minZ + 1]} zIndexRange={[20, 0]}>
              <div className="group-label">
                <span>
                  {layout === 'application'
                    ? 'Application'
                    : layout === 'node'
                      ? 'Node group'
                      : 'Namespace'}
                </span>
                <strong>{region.name}</strong>
                <small>
                  {region.items.length} objects{unhealthy ? ` · ${unhealthy} need attention` : ''}
                </small>
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

function topologyGroupKey(resource: Resource, layout: LayoutMode): string {
  if (layout === 'node') return String(resource.properties.nodeName ?? 'unassigned');
  if (layout === 'application' || layout === 'service')
    return (
      resource.labels['app.kubernetes.io/name'] ??
      resource.labels.app ??
      resource.namespace ??
      'cluster'
    );
  return resource.namespace ?? 'cluster';
}

function groupColor(name: string): string {
  const palette = ['#2587bd', '#6d5fd2', '#168d85', '#9b6b2f', '#3f70b5', '#7955a8'];
  let value = 2166136261;
  for (let index = 0; index < name.length; index += 1)
    value = Math.imul(value ^ name.charCodeAt(index), 16777619);
  return palette[Math.abs(value) % palette.length]!;
}

function ResourceInstances({
  availableModels,
  layers,
}: {
  availableModels: ReadonlySet<string>;
  layers: TopologyLayer[];
}) {
  const resourceMap = useTopologyStore((state) => state.resources);
  const positions = useTopologyStore((state) => state.positions);
  const search = useTopologyStore((state) => state.search.toLocaleLowerCase());
  const namespace = useTopologyStore((state) => state.namespace);
  const visibleKinds = useTopologyStore((state) => state.visibleKinds);
  const resources = useMemo(() => Object.values(resourceMap), [resourceMap]);
  const filtered = useMemo(
    () =>
      resources.filter((resource) =>
        isTopologyResourceVisible(resource, layers, search, namespace, visibleKinds),
      ),
    [layers, namespace, resources, search, visibleKinds],
  );
  const groups = useMemo(() => {
    const grouped = new Map<
      string,
      { kind: ResourceKind; definition: AssetDefinition; resources: Resource[] }
    >();
    for (const resource of filtered) {
      const definition = assetForResource(resource);
      const key = `${resource.kind}:${definition.modelPath}`;
      const group = grouped.get(key);
      if (group) group.resources.push(resource);
      else grouped.set(key, { kind: resource.kind, definition, resources: [resource] });
    }
    return [...grouped.entries()];
  }, [filtered]);
  return (
    <>
      {groups.map(([key, group]) => (
        <InstanceGroup
          key={key}
          kind={group.kind}
          definition={group.definition}
          resources={group.resources}
          positions={positions}
          modelAvailable={availableModels.has(group.definition.modelPath)}
        />
      ))}
    </>
  );
}

function InstanceGroup({
  kind,
  definition,
  resources,
  positions,
  modelAvailable,
}: {
  kind: ResourceKind;
  definition: AssetDefinition;
  resources: Resource[];
  positions: Record<string, Position>;
  modelAvailable: boolean;
}) {
  const proceduralGeometry = useMemo(
    () => fallbackGeometry(definition.fallback),
    [definition.fallback],
  );
  const procedural = (
    <RenderedInstanceGroup
      kind={kind}
      definition={definition}
      resources={resources}
      positions={positions}
      geometry={proceduralGeometry}
    />
  );
  if (!modelAvailable) return procedural;
  return (
    <Suspense fallback={procedural}>
      <LoadedModelGroup
        kind={kind}
        definition={definition}
        resources={resources}
        positions={positions}
      />
    </Suspense>
  );
}

function LoadedModelGroup({
  kind,
  definition,
  resources,
  positions,
}: {
  kind: ResourceKind;
  definition: AssetDefinition;
  resources: Resource[];
  positions: Record<string, Position>;
}) {
  const model = useGLTF(definition.modelPath, '/draco/');
  const loaded = useMemo(() => {
    let sourceMesh: THREE.Mesh | undefined;
    model.scene.traverse((object) => {
      if (!sourceMesh && object instanceof THREE.Mesh) sourceMesh = object;
    });
    if (!sourceMesh) return { geometry: fallbackGeometry(definition.fallback) };
    const result = sourceMesh.geometry.clone();
    const transform = new THREE.Matrix4().compose(
      new THREE.Vector3(...definition.positionOffset),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...definition.rotation)),
      new THREE.Vector3(...definition.scale),
    );
    result.applyMatrix4(transform);
    const material = Array.isArray(sourceMesh.material)
      ? sourceMesh.material[0]
      : sourceMesh.material;
    return { geometry: result, material };
  }, [definition, model.scene]);
  return (
    <RenderedInstanceGroup
      kind={kind}
      definition={definition}
      resources={resources}
      positions={positions}
      geometry={loaded.geometry}
      material={loaded.material}
    />
  );
}

function RenderedInstanceGroup({
  kind,
  definition,
  resources,
  positions,
  geometry,
  material,
}: {
  kind: ResourceKind;
  definition: AssetDefinition;
  resources: Resource[];
  positions: Record<string, Position>;
  geometry: THREE.BufferGeometry;
  material?: THREE.Material;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const select = useTopologyStore((state) => state.select);
  const setHovered = useTopologyStore((state) => state.setHovered);
  const requestFocus = useTopologyStore((state) => state.requestFocus);
  const selectedIds = useTopologyStore((state) => state.selectedIds);
  const hoveredId = useTopologyStore((state) => state.hoveredId);
  useEffect(() => {
    if (!mesh.current) return;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    resources.forEach((resource, index) => {
      const position = positions[resource.id] ?? { x: 0, y: 0, z: 0 };
      const scale = kind === 'Cluster' ? 2.4 : kind === 'Namespace' ? 1.8 : 1;
      matrix.compose(
        new THREE.Vector3(position.x, position.y, position.z),
        new THREE.Quaternion(),
        new THREE.Vector3(scale, scale, scale),
      );
      mesh.current!.setMatrixAt(index, matrix);
      if (!material)
        mesh.current!.setColorAt(index, color.set(definition.healthMaterials[resource.health]));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [definition.healthMaterials, kind, material, positions, resources]);
  useEffect(() => {
    mesh.current?.computeBoundingSphere();
  }, [positions, resources]);
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.instanceId !== undefined) select(resources[event.instanceId]!.id, event.shiftKey);
  };
  const onDoubleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.instanceId !== undefined) {
      const resource = resources[event.instanceId]!;
      select(resource.id);
      setHovered(resource.id);
      requestFocus(resource.id);
    }
  };
  const onContextMenu = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    if (event.instanceId !== undefined) select(resources[event.instanceId]!.id);
  };
  return (
    <>
      <instancedMesh
        ref={mesh}
        args={[geometry, material, resources.length]}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onPointerMove={(event) => {
          event.stopPropagation();
          if (!useTopologyStore.getState().navigationActive && event.instanceId !== undefined)
            setHovered(resources[event.instanceId]!.id);
        }}
        onPointerOut={() => setHovered(undefined)}
        castShadow
        receiveShadow
      >
        {!material && (
          <meshStandardMaterial
            roughness={0.36}
            metalness={0.55}
            emissive="#0a1422"
            emissiveIntensity={0.5}
          />
        )}
      </instancedMesh>
      <HealthMarkers definition={definition} resources={resources} positions={positions} />
      {resources
        .filter((resource) => selectedIds.includes(resource.id) || hoveredId === resource.id)
        .slice(0, 8)
        .map((resource) => {
          const position = positions[resource.id];
          return position ? (
            <Html
              key={resource.id}
              position={[position.x, position.y + 1.8, position.z]}
              center
              zIndexRange={[100, 0]}
            >
              <div className="scene-label">
                <strong>{resource.name}</strong>
                <span>
                  {resource.namespace ?? 'cluster'} · {resource.kind} · {resource.status}
                </span>
              </div>
            </Html>
          ) : null;
        })}
    </>
  );
}

function HealthMarkers({
  definition,
  resources,
  positions,
}: {
  definition: AssetDefinition;
  resources: Resource[];
  positions: Record<string, Position>;
}) {
  const groups = useMemo(() => {
    const grouped = new Map<Resource['health'], Resource[]>();
    for (const resource of resources) {
      const group = grouped.get(resource.health);
      if (group) group.push(resource);
      else grouped.set(resource.health, [resource]);
    }
    return [...grouped.entries()];
  }, [resources]);
  return (
    <>
      {groups.map(([health, items]) => (
        <HealthMarkerInstances
          key={health}
          color={definition.healthMaterials[health]}
          resources={items}
          positions={positions}
        />
      ))}
    </>
  );
}

function HealthMarkerInstances({
  color,
  resources,
  positions,
}: {
  color: string;
  resources: Resource[];
  positions: Record<string, Position>;
}) {
  const markers = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!markers.current) return;
    const matrix = new THREE.Matrix4();
    resources.forEach((resource, index) => {
      const position = positions[resource.id] ?? { x: 0, y: 0, z: 0 };
      matrix.makeTranslation(position.x + 0.68, position.y + 0.88, position.z);
      markers.current!.setMatrixAt(index, matrix);
    });
    markers.current.instanceMatrix.needsUpdate = true;
    markers.current.computeBoundingSphere();
  }, [positions, resources]);
  return (
    <instancedMesh ref={markers} args={[undefined, undefined, resources.length]} renderOrder={10}>
      <sphereGeometry args={[0.13, 12, 8]} />
      <meshBasicMaterial color={color} toneMapped={false} depthTest={false} depthWrite={false} />
    </instancedMesh>
  );
}

const workloadRelationshipTypes = new Set<RelationshipType>([
  'routes-to',
  'exposes',
  'depends-on',
  'traffic',
  'trace',
]);

function ConnectionLines({ layers }: { layers: TopologyLayer[] }) {
  const resourceMap = useTopologyStore((state) => state.resources);
  const relationshipMap = useTopologyStore((state) => state.relationships);
  const positions = useTopologyStore((state) => state.positions);
  const selected = useTopologyStore((state) => state.selectedIds);
  const search = useTopologyStore((state) => state.search.toLocaleLowerCase());
  const namespace = useTopologyStore((state) => state.namespace);
  const visibleKinds = useTopologyStore((state) => state.visibleKinds);
  const relationships = useMemo(() => Object.values(relationshipMap), [relationshipMap]);
  const visibleResourceIds = useMemo(
    () =>
      new Set(
        Object.values(resourceMap)
          .filter((resource) =>
            isTopologyResourceVisible(resource, layers, search, namespace, visibleKinds),
          )
          .map((resource) => resource.id),
      ),
    [layers, namespace, resourceMap, search, visibleKinds],
  );
  const visible = useMemo(() => {
    const allowedTypes = relationshipTypesForLayers(layers);
    const result = new Map<string, Relationship>();
    for (const edge of collapseWorkloadRelationships(relationships, visibleResourceIds)) {
      if (allowedTypes.has(edge.type)) result.set(edge.id, edge);
    }
    for (const edge of relationships) {
      if (
        allowedTypes.has(edge.type) &&
        visibleResourceIds.has(edge.source) &&
        visibleResourceIds.has(edge.target)
      )
        result.set(edge.id, edge);
    }
    const edges = [...result.values()];
    const selectedEdges = edges.filter(
      (edge) => selected.includes(edge.source) || selected.includes(edge.target),
    );
    const backgroundEdges = edges.filter(
      (edge) => !selected.includes(edge.source) && !selected.includes(edge.target),
    );
    const limit = layers.length === 1 ? 180 : 700;
    return [
      ...backgroundEdges.slice(0, Math.max(0, limit - selectedEdges.length)),
      ...selectedEdges,
    ].slice(-limit);
  }, [layers, relationships, selected, visibleResourceIds]);

  return (
    <>
      {visible.map((edge) => {
        const source = positions[edge.source];
        const target = positions[edge.target];
        if (!source || !target) return null;
        const connected = selected.includes(edge.source) || selected.includes(edge.target);
        const observed = edge.type === 'traffic' || edge.type === 'trace';
        const midpoint: [number, number, number] = [
          (source.x + target.x) / 2,
          Math.max(source.y, target.y) + (observed ? 3.6 : 2.6),
          (source.z + target.z) / 2,
        ];
        const points: Array<[number, number, number]> = [
          [source.x, source.y, source.z],
          midpoint,
          [target.x, target.y, target.z],
        ];
        return (
          <group key={edge.id}>
            <Line
              points={points}
              color={relationshipColor(edge, connected)}
              transparent
              opacity={connected ? 0.98 : selected.length ? 0.22 : observed ? 0.88 : 0.54}
              lineWidth={connected ? 2.4 : observed ? 1.8 : 1.15}
            />
            {observed && <TrafficPulse points={points} offset={stableOffset(edge.id)} />}
          </group>
        );
      })}
    </>
  );
}

function relationshipTypesForLayers(layers: ReadonlyArray<TopologyLayer>): Set<RelationshipType> {
  const types = new Set<RelationshipType>(['routes-to', 'exposes', 'depends-on']);
  if (layers.includes('replicas')) types.add('owns');
  if (layers.includes('nodes')) {
    types.add('scheduled-on');
    types.add('contains');
  }
  if (layers.includes('storage')) {
    types.add('mounts');
    types.add('binds');
  }
  if (layers.includes('configuration')) {
    types.add('configures');
    types.add('authenticates-as');
    types.add('scales');
  }
  if (layers.includes('security')) types.add('governs');
  if (layers.includes('traffic')) {
    types.add('traffic');
    types.add('trace');
  }
  return types;
}

function TrafficPulse({
  points,
  offset,
}: {
  points: Array<[number, number, number]>;
  offset: number;
}) {
  const marker = useRef<THREE.Mesh>(null);
  const curve = useMemo(
    () =>
      new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(...points[0]!),
        new THREE.Vector3(...points[1]!),
        new THREE.Vector3(...points[2]!),
      ),
    [points],
  );
  useFrame(({ clock }) => {
    if (!marker.current) return;
    marker.current.position.copy(curve.getPoint((clock.elapsedTime * 0.22 + offset) % 1));
  });
  return (
    <mesh ref={marker}>
      <sphereGeometry args={[0.16, 10, 10]} />
      <meshBasicMaterial color="#2dd4bf" />
    </mesh>
  );
}

function stableOffset(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1)
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0;
  return Math.abs(hash % 1000) / 1000;
}

function collapseWorkloadRelationships(
  relationships: ReadonlyArray<Relationship>,
  visibleIds: ReadonlySet<string>,
): Relationship[] {
  const ownerByChild = new Map(
    relationships.filter((edge) => edge.type === 'owns').map((edge) => [edge.target, edge.source]),
  );
  const collapse = (resourceId: string) => {
    let current: string | undefined = resourceId;
    for (let depth = 0; current && depth < 8; depth += 1) {
      if (visibleIds.has(current)) return current;
      current = ownerByChild.get(current);
    }
    return undefined;
  };
  const result = new Map<string, Relationship>();
  for (const edge of relationships) {
    if (!workloadRelationshipTypes.has(edge.type)) continue;
    const source = collapse(edge.source);
    const target = collapse(edge.target);
    if (!source || !target || source === target) continue;
    const id = `summary:${edge.type}:${source}:${target}`;
    result.set(id, {
      ...edge,
      id,
      source,
      target,
      metadata: { ...edge.metadata, summarized: source !== edge.source || target !== edge.target },
    });
  }
  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function relationshipColor(edge: Relationship, emphasized: boolean): string {
  if (edge.health === 'unhealthy') return '#fb7185';
  if (emphasized) return '#7dd3fc';
  if (edge.type === 'traffic' || edge.type === 'trace') return '#2dd4bf';
  if (edge.type === 'exposes') return '#a78bfa';
  if (edge.type === 'depends-on' || edge.type === 'mounts' || edge.type === 'binds')
    return '#fbbf24';
  if (edge.type === 'governs') return '#f472b6';
  if (edge.type === 'owns' || edge.type === 'contains') return '#64748b';
  return '#3988b4';
}

function CameraRig({ command }: { command: { type: 'reset' | 'fit'; nonce: number } | null }) {
  const { camera } = useThree();
  const controls = useThree((state) => state.controls) as
    | { target?: THREE.Vector3; update?: () => void }
    | undefined;
  const positions = useTopologyStore((state) => state.positions);
  const focusRequest = useTopologyStore((state) => state.focusRequest);
  const navigationActive = useTopologyStore((state) => state.navigationActive);
  const animation = useRef<{ camera: THREE.Vector3; controls: THREE.Vector3 } | null>(null);
  const handledCommand = useRef<number | undefined>(undefined);
  const handledFocus = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (navigationActive) animation.current = null;
  }, [navigationActive]);
  useEffect(() => {
    if (!focusRequest || handledFocus.current === focusRequest.nonce) return;
    const position = positions[focusRequest.resourceId];
    if (!position) return;
    handledFocus.current = focusRequest.nonce;
    animation.current = {
      camera: new THREE.Vector3(position.x + 9, position.y + 7, position.z + 12),
      controls: new THREE.Vector3(position.x, position.y, position.z),
    };
  }, [focusRequest, positions]);
  useEffect(() => {
    if (!command || handledCommand.current === command.nonce) return;
    handledCommand.current = command.nonce;
    animation.current = null;
    if (command.type === 'reset') {
      camera.position.set(...defaultCameraPosition);
      controls?.target?.set(...defaultCameraTarget);
    } else {
      const points = Object.values(positions).map(
        (item) => new THREE.Vector3(item.x, item.y, item.z),
      );
      if (points.length) {
        const sphere = new THREE.Box3().setFromPoints(points).getBoundingSphere(new THREE.Sphere());
        const distance = Math.max(18, sphere.radius * 2.5);
        camera.position.set(
          sphere.center.x + distance * 0.7,
          sphere.center.y + distance * 0.55,
          sphere.center.z + distance,
        );
        controls?.target?.copy(sphere.center);
      }
    }
    controls?.update?.();
  }, [camera, command, controls, positions]);
  useFrame((_state, delta) => {
    const target = animation.current;
    if (!target) return;
    camera.position.lerp(target.camera, Math.min(1, delta * 2.8));
    controls?.target?.lerp(target.controls, Math.min(1, delta * 3.2));
    controls?.update?.();
    if (
      camera.position.distanceTo(target.camera) < 0.05 &&
      (!controls?.target || controls.target.distanceTo(target.controls) < 0.05)
    )
      animation.current = null;
  });
  return null;
}

function fallbackGeometry(kind: ReturnType<typeof assetFor>['fallback']): THREE.BufferGeometry {
  if (kind === 'sphere') return new THREE.IcosahedronGeometry(0.72, 2);
  if (kind === 'cylinder') return new THREE.CylinderGeometry(0.62, 0.76, 1.25, 16);
  if (kind === 'cone') return new THREE.ConeGeometry(0.75, 1.4, 16);
  if (kind === 'octahedron') return new THREE.OctahedronGeometry(0.82);
  if (kind === 'torus') return new THREE.TorusGeometry(0.62, 0.2, 10, 22);
  return new THREE.BoxGeometry(1.15, 1.15, 1.15, 2, 2, 2);
}
