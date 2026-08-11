# ConStack

ConStack turns a Kubernetes cluster into a live, interactive 3D digital twin. It discovers resources through Kubernetes watches, builds ownership/routing/storage relationships, streams incremental updates, and combines status, events, logs, metrics, and deterministic diagnostics in one operations console.

ConStack is read-only by default. Optional operational actions require a separate worker, ServiceAccount, write RBAC, a user-created preview, and explicit confirmation. Optional external analysis is permanently recommendation-only: it has no Kubernetes token, no action dependency, and no route that can apply a recommendation.

## Quick start with Helm

Prerequisites: Kubernetes 1.34–1.36, Helm 4, a default StorageClass, and outbound access to the configured image registry.

```bash
helm upgrade --install constack oci://ghcr.io/constack-co/charts/constack \
  --version 0.1.0 \
  --namespace constack \
  --create-namespace \
  --wait

kubectl port-forward service/constack 3000:80 -n constack
```

Released images are pulled from GHCR; Helm does not require access to a local Docker image store. Enterprises may mirror the images and chart into an approved registry and override the repositories without changing nodes, runtimes, or cluster networking. Private registries are supported through `global.imagePullSecrets`.

Open <http://localhost:3000>. Retrieve the generated bootstrap password with the command printed by Helm, or provide `bootstrap.adminPassword` through a protected values source. The default install includes persistent single-node MySQL and Redis for evaluation; use external managed services for production.

## Local demo

Node.js 24, Corepack, Docker, and pnpm are required.

```bash
corepack enable
pnpm install
docker compose up --build
```

Open <http://localhost:8080> and use `admin@constack.local` / `constack-development-admin`. Compose runs fixture topology mode and does not connect to a Kubernetes cluster.

For direct development:

```bash
cp .env.example .env
docker compose up mysql redis -d
pnpm --filter @constack/api migration:run
pnpm dev
```

## Repository layout

```text
apps/
  web/                 Next.js operations console and 3D scene
  api/                 NestJS REST, auth, WebSocket, audit, and queue producers
  discovery-worker/    Read-only Kubernetes watchers and topology reconciliation
  analysis-worker/     Tokenless recommendation-only generic HTTP integration
  action-worker/       Optional human-confirmed Kubernetes mutations
packages/
  analysis-contracts/   Recommendation-only schemas with no action/Kubernetes types
  shared-types/        Versioned Zod API and event contracts
  kubernetes-types/    Safe Kubernetes projections and watch registry
  topology-engine/     Relationships, deterministic layouts, and local diagnostics
  three-assets/        GLB registry, LOD, materials, and fallback geometry
  architecture-tests/  Enforced analysis/action dependency boundaries
deploy/
  helm/constack/       Canonical installation source
  kubernetes/          Rendered default read-only manifest
  docker/              Production container definitions and gateway config
docs/                  Architecture, operations, security, and extension guides
```

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
helm lint deploy/helm/constack
helm template constack deploy/helm/constack --namespace constack
```

The API publishes OpenAPI at `/api/docs` and `/api/docs/openapi.json`. Administrator-only user endpoints create local or pre-provisioned OIDC accounts; there is no signup route.

See [installation](docs/installation/README.md), [architecture](docs/architecture/README.md), [security](docs/security/README.md), and [development](docs/development/README.md) for operational detail.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Security vulnerabilities must be reported according to [SECURITY.md](SECURITY.md), not in a public issue. Project conduct is described in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and release notes are maintained in [CHANGELOG.md](CHANGELOG.md).

Licensed under the Apache License 2.0.
