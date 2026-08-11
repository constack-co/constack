# Architecture

ConStack separates live Kubernetes state from historical product data.

```text
Kubernetes API ──watch──> discovery-worker ──> Redis graph/patches ──> API/WebSocket ──> Web 3D scene
                                  │                    │
                                  └──sanitized history┴──> MySQL

Web ──explicit request──> API ──constack-analysis──> analysis-worker ──HTTPS──> company endpoint
Web ──preview+confirm───> API ──constack-actions────> action-worker ──────────> Kubernetes API
```

The discovery worker performs list/watch initialization, continues from resource versions, reconciles initial-event sets, resets after `410 Gone`, and restarts with exponential backoff. Every Kubernetes object is reduced to the shared `Resource` contract before it enters Redis, MySQL, logs, REST, or WebSockets. Secret data, ConfigMap contents, literal environment variables, and full manifests are absent from that contract.

Redis stores the current graph, sequence numbers, sessions, short-lived action previews, BullMQ jobs, and pub/sub events. MySQL stores accounts, organization memberships, configuration, deduplicated snapshots, relationship history, events, saved views, recommendations, action history, and append-only audit events. Kubernetes remains authoritative.

The 3D client applies sequence-checked patches to normalized Zustand maps. It uses deterministic layouts, a layout Web Worker, per-kind instanced meshes, shared materials, capped relationship rendering, semantic filtering, and procedural fallback geometry. A build-time asset manifest enables later GLB substitution without changing topology code.

## Hard analysis/action boundary

The external-analysis response schema lives in a dedicated package that contains no Kubernetes or action types. It is strict and contains narrative findings only. Unknown fields such as `action`, `patch`, `queueName`, or `confirmationToken` are rejected. The analysis worker has no Kubernetes dependency, does not mount a Kubernetes token, cannot publish to the action queue, and is denied general egress by default.

The action worker consumes only `execute-human-confirmed-action` jobs containing a single-use preview created by an authenticated Operator or Administrator. It rereads the resource and compares UID/resourceVersion before mutation. There is intentionally no recommendation-to-action conversion endpoint or UI control.
