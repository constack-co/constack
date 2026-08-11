# Security model

- Kubernetes access is read-only by default. Secret metadata watching and all writes are separate opt-ins; when enabled, Secret read permission is granted only to the discovery ServiceAccount.
- Secret `data`/`stringData`, ConfigMap content, service-account tokens, literal environment values, and raw manifests are removed at the normalization boundary.
- Local passwords use Argon2id. Sessions are opaque, Redis-backed, expiring, HTTP-only cookies. Mutations require CSRF headers and valid same-origin sessions.
- Generic OIDC uses discovery, Authorization Code, state, nonce validation, and PKCE. An administrator must provision the account first; unknown OIDC identities are rejected and there is no public signup.
- Viewer, Operator, and Administrator checks run in API guards and all records are organization-scoped.
- Action previews are single-use, expire after five minutes, bind to user/organization/UID/resourceVersion, and require a second explicit request with an idempotency key.
- The analysis worker depends on a dedicated recommendation-only contract package, not the shared action contracts. It has no Kubernetes client dependency or service-account token. Responses are strict recommendation objects; executable fields are rejected.
- Pods run non-root with seccomp, dropped capabilities, bounded resources, and read-only root filesystems where upstream datastore images permit it.
- Audit events record user-management changes, action previews, denials, confirmations, queued work, execution results, integration changes, and failures without request secrets. Authentication event auditing is not yet implemented.

Run `pnpm --filter @constack/architecture-tests test` after any worker/module refactor. It fails if the analysis worker gains Kubernetes or action-queue dependencies.
