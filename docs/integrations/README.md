# Integration contracts

`ObservabilityAdapter` is provider-neutral and exposes capability discovery, health, metrics, logs, traces, and traffic methods. Kubernetes status/events/logs and the aggregated Metrics API are the built-in baseline. New adapters must return normalized data and must never insert fabricated topology edges.

`ExternalAnalysisProvider` accepts only the versioned, sanitized `ExternalAnalysisRequest` from `@constack/analysis-contracts` and returns a strict `ExternalAnalysisResponse`. The HTTP adapter sends no raw logs, manifests, annotations, Secret/ConfigMap content, or environment values. Administrators separately permit event and metric summaries with `ai.context`; users choose whether each permitted optional category is included in a request. Response fields are recommendations and illustrative text only.

Provider implementations must live in the analysis worker or a package depended on only by that worker. They must not import the Kubernetes client, action packages, action DTOs, or action queue names. Do not add buttons or endpoints that convert recommendations into previews or actions.

Kubernetes-kind GLBs use `apps/web/public/models/<kubernetes-kind-lowercase>-3d.glb`. Build and dev startup validate the assets and generate `apps/web/public/models/manifest.json`; models are then loaded lazily, while missing entries use procedural geometry without a failed request. Image-specific overrides such as Redis remain registered in `packages/three-assets`. The build bundles Three.js' Draco decoder under `/draco/`, so no decoder CDN is contacted.
