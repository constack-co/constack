{{- define "constack.name" -}}constack{{- end }}
{{- define "constack.fullname" -}}{{ .Release.Name }}{{- end }}
{{- define "constack.labels" -}}
app.kubernetes.io/name: constack
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{- end }}
{{- define "constack.selectorLabels" -}}
app.kubernetes.io/name: constack
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
{{- define "constack.secretName" -}}{{ default (printf "%s-config" (include "constack.fullname" .)) .Values.existingSecret }}{{- end }}
{{- define "constack.databaseUrl" -}}{{- if .Values.mysql.enabled -}}mysql://constack:{{ .Values._generatedPassword | default "constack" }}@{{ include "constack.fullname" . }}-mysql:3306/constack{{- else -}}{{ required "mysql.externalUrl is required when mysql.enabled=false" .Values.mysql.externalUrl }}{{- end -}}{{- end }}
{{- define "constack.redisUrl" -}}{{- if .Values.redis.enabled -}}redis://{{ include "constack.fullname" . }}-redis:6379{{- else -}}{{ required "redis.externalUrl is required when redis.enabled=false" .Values.redis.externalUrl }}{{- end -}}{{- end }}
{{- define "constack.securityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
runAsNonRoot: true
runAsUser: 10001
capabilities:
  drop: ["ALL"]
seccompProfile:
  type: RuntimeDefault
{{- end }}
{{- define "constack.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}
