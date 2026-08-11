# Development

## Toolchain

Use Node.js 24 and the pinned pnpm version. Run `corepack enable`, then `pnpm install`.

The API requires MySQL and Redis. Copy `.env.example`, start the datastores with Compose, run migrations, and launch `pnpm dev`. `DEMO_MODE=true` supplies a representative topology without a Kubernetes connection.

To test real discovery, run the discovery worker with a current kubeconfig:

```bash
pnpm --filter @constack/discovery-worker dev
```

Use a non-production cluster and a read-only context. Secret watching remains off unless explicitly enabled.

## 3D assets

Place a GLB v2 file at `apps/web/public/models/<kubernetes-kind-lowercase>-3d.glb`, for example `deployment-3d.glb`, `replicaset-3d.glb`, or `service-3d.glb`. Build and dev startup validate every GLB and generate `manifest.json` automatically. The registry in `packages/three-assets` owns transforms, label offsets, health markers, LOD thresholds, and fallback geometry. The application never requires a model to render a resource.

## Quality gates

Every change must pass type checking, unit tests, production builds, Helm lint/render, and architecture boundary tests. Kubernetes integration tests should exercise list/watch initialization, reconnects, `410 Gone`, real-time patch sequence gaps, and install/uninstall behavior.

The topology-engine test suite generates 10,000 resources and at least 25,000 relationships and enforces a five-second CPU-side layout/relationship budget. Before a release, also record a Chrome performance trace at 1920x1080 on a desktop with at least an RTX 3060-class GPU or Apple M2-class integrated GPU: load the same fixture, leave labels capped, orbit/fly for 60 seconds, and confirm interaction remains near 60 FPS without unbounded heap growth. Record the browser, OS, GPU, median FPS, p95 frame time, and peak heap with the release artifact; CI cannot establish GPU frame rate on a hosted runner.
