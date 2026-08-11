# Changelog

All notable user-facing changes are documented here. This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Security and release readiness

- Added browser-facing security headers and production secret validation.
- Restricted optional Secret metadata permissions to the discovery worker.
- Made external AI egress configuration mandatory when Kubernetes NetworkPolicies are enabled.
- Added formatting and ESLint enforcement to the normal verification path.

## 0.1.0

- Initial release candidate of the ConStack Kubernetes observability console and 3D topology viewer.
