{{- define "triatlon.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "triatlon.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "triatlon.selector" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "triatlon.image" -}}
{{- $tag := required "image.tag je povinný (výstup deploy/k8s/build-push.sh)" .root.Values.image.tag -}}
{{- printf "%s/triatlon-%s:%s" .root.Values.image.registry .name $tag -}}
{{- end -}}

{{- define "triatlon.webUrl" -}}
{{- printf "%s://%s" (ternary "https" "http" .Values.ingress.tls.enabled) .Values.host -}}
{{- end -}}

{{- define "triatlon.secret" -}}
{{- required "existingSecret je povinný (viz deploy/k8s/README.md)" .Values.existingSecret -}}
{{- end -}}

{{/* Proměnné pro připojení k databázi (API i zálohy). */}}
{{- define "triatlon.dbEnv" -}}
{{- if .Values.postgres.enabled }}
- name: POSTGRES_USER
  value: {{ .Values.postgres.user | quote }}
- name: POSTGRES_DB
  value: {{ .Values.postgres.database | quote }}
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef: { name: {{ include "triatlon.secret" . }}, key: POSTGRES_PASSWORD }
- name: DATABASE_URL
  value: postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@{{ include "triatlon.fullname" . }}-postgres:5432/$(POSTGRES_DB)
{{- else }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef: { name: {{ include "triatlon.secret" . }}, key: DATABASE_URL }
{{- end }}
{{- end -}}
