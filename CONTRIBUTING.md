# Contributing to ConStack

Thanks for contributing. Please open an issue or discussion before beginning a large feature so the scope and design can be agreed early.

## Development workflow

1. Create a focused branch from `main`.
2. Keep changes small, documented, and covered by tests where behaviour changes.
3. Run `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, and `helm lint deploy/helm/constack` before opening a pull request.
4. Describe user-visible changes, Kubernetes/RBAC impact, configuration changes, and verification in the pull request.

Do not add credentials, cluster manifests containing sensitive values, production logs, or unlicensed assets. Changes affecting Kubernetes permissions, authentication, sessions, actions, or external analysis require explicit security review from a project maintainer.

By contributing, you agree that your contribution is licensed under the repository's Apache License 2.0 terms.
