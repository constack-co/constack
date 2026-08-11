# Static Kubernetes manifests

`constack.yaml` is generated from the canonical Helm chart with `existingSecret=constack-runtime`. Create the runtime Secret first, then apply the manifest:

```bash
kubectl create namespace constack
kubectl apply -n constack -f constack-secret.example.yaml
# Replace every CHANGE_ME value before applying the Secret.
kubectl apply -n constack -f constack.yaml
kubectl port-forward service/constack 3000:80 -n constack
```

Regenerate the manifest after chart changes:

```bash
helm template constack ../helm/constack --namespace constack --set existingSecret=constack-runtime > constack.yaml
```

The static default is read-only: no action worker, write RBAC, analysis worker, or external-analysis egress is present.
