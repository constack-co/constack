'use client';

import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { TopologyPatch, TopologySnapshot } from '@constack/shared-types';
import { useTopologyStore } from './topology-store';

export function useRealtime(onResync: () => void) {
  const clusterId = useTopologyStore((state) => state.clusterId);
  const sequence = useTopologyStore((state) => state.sequence);
  const applyPatch = useTopologyStore((state) => state.applyPatch);
  const setSnapshot = useTopologyStore((state) => state.setSnapshot);
  const needsResync = useTopologyStore((state) => state.needsResync);
  const sequenceRef = useRef(sequence);

  useEffect(() => {
    sequenceRef.current = sequence;
  }, [sequence]);
  useEffect(() => {
    if (needsResync) onResync();
  }, [needsResync, onResync]);
  useEffect(() => {
    if (!clusterId) return;
    const socket = io('/realtime', {
      path: '/socket.io',
      transports: ['websocket'],
      withCredentials: true,
    });
    socket.on('connect', () =>
      socket.emit('subscribe', { clusterId, lastSequence: sequenceRef.current }),
    );
    socket.on('topology.snapshot', (snapshot: TopologySnapshot) => setSnapshot(snapshot));
    socket.on('topology.patch', (patch: TopologyPatch) => applyPatch(patch));
    socket.on('resync.required', onResync);
    return () => {
      socket.disconnect();
    };
  }, [applyPatch, clusterId, onResync, setSnapshot]);
}
