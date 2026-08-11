# Installation and upgrades

## Default installation

The default chart installs the gateway, web application, API, discovery worker, persistent MySQL, and persistent Redis. Operational actions, external analysis, Ingress, and Secret metadata discovery are disabled.

```bash
helm upgrade --install constack oci://ghcr.io/constack-co/charts/constack --version 0.1.0 -n constack --create-namespace --wait
kubectl port-forward service/constack 3000:80 -n constack
```

The OCI chart references signed, multi-architecture release images in GHCR. A source checkout is not required. Helm creates ordinary Kubernetes resources and does not change the container runtime, node configuration, DNS, or cluster networking.

## Enterprise registry mirror

Mirror the chart and images into the organization's approved OCI registry, create or reference the normal Kubernetes registry credential, and supply a protected values file:

```yaml
global:
  imagePullSecrets:
    - name: enterprise-registry
images:
  services:
    repository: registry.company.example/constack/services
    tag: v0.1.0
  web:
    repository: registry.company.example/constack/web
    tag: v0.1.0
  gateway:
    repository: registry.company.example/mirrors/nginx
    tag: 1.29-alpine
mysql:
  image: registry.company.example/mirrors/mysql:8.4
redis:
  image: registry.company.example/mirrors/redis:8-alpine
```

```bash
helm upgrade --install constack oci://registry.company.example/charts/constack --version 0.1.0 -n constack --create-namespace -f enterprise-values.yaml --wait
```

This uses the organization's existing registry path; it does not require a local registry, Kind image loading, a privileged importer, or Kubernetes node changes.

When developing from unpublished source in a Kind cluster, local Docker images must be loaded into the Kind nodes before using `imagePullPolicy=Never`. This is a development-only workflow and is not part of the enterprise installation.

Use `service.type=LoadBalancer` or `service.type=NodePort` for direct exposure, or configure `ingress.enabled`, `ingress.host`, `ingress.className`, and `ingress.tls`.

## Production dependencies

Disable bundled datastores and provide connection URLs in a protected values source:

```yaml
mysql:
  enabled: false
  externalUrl: mysql://user:password@mysql.example:3306/constack
redis:
  enabled: false
  externalUrl: rediss://redis.example:6379
existingSecret: constack-runtime
```

The referenced Secret must provide `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, and `BOOTSTRAP_ADMIN_PASSWORD`. Use a highly available MySQL/Redis service, TLS, backups, and network controls in production.

## Optional actions

`actions.enabled=true` installs the action worker and its separate write-capable ServiceAccount. It does not enable actions for Viewers, bypass previews, or permit node drain/cordon/rollback. Review the rendered ClusterRole before installation.

## Optional external recommendations

External analysis is generic and disabled by default:

```yaml
ai:
  enabled: true
  endpoint: https://analysis.company.example/v1/recommend
  existingSecret: constack-analysis-auth
  authHeaderKey: auth-header
  context:
    events: false
    metrics: false
  networkPolicy:
    additionalEgress:
      - to:
          - ipBlock: { cidr: 203.0.113.10/32 }
        ports: [{ protocol: TCP, port: 443 }]
```

The Secret value uses `Header-Name: value` format. The analysis Pod has no Kubernetes token. When `networkPolicy.enabled=true` (the default), `ai.networkPolicy.additionalEgress` is required and must allow the provider's resolved IP range and port; Helm refuses an AI-enabled installation without it.

`ai.context.events` and `ai.context.metrics` are administrator allow-lists, both false by default. Even when permitted, a user sees and selects the optional categories for each request. Resource status and deterministic local findings are always sanitized; raw logs, annotations, manifests, and environment values are never eligible.

History retention is configurable under `retention.resourceHistoryDays` (7), `retention.incidentRecommendationDays` (90), and `retention.auditDays` (365).

## Upgrades

The chart runs TypeORM migrations as a Helm pre-upgrade hook. Back up MySQL before upgrading. Use immutable image digests for controlled releases and review RBAC/chart differences with `helm diff`.
