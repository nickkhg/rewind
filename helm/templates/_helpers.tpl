{{/*
Expand the name of the chart.
*/}}
{{- define "rewind.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "rewind.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "rewind.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "rewind.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "rewind.selectorLabels" -}}
app.kubernetes.io/name: {{ include "rewind.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Fully qualified name for the PostgreSQL StatefulSet and Service.
*/}}
{{- define "rewind.postgresFullname" -}}
{{- printf "%s-postgres" (include "rewind.fullname" .) }}
{{- end }}

{{/*
Name of the TLS Secret used by the Ingress, derived from the tls.mode.
Returns an empty string when mode=none.
*/}}
{{- define "rewind.tlsSecretName" -}}
{{- if eq .Values.ingress.tls.mode "certManager" -}}
{{- default (printf "%s-tls" (include "rewind.fullname" .)) .Values.ingress.tls.certManager.secretName }}
{{- else if eq .Values.ingress.tls.mode "existingSecret" -}}
{{- required "ingress.tls.existingSecret.name is required when tls.mode=existingSecret" .Values.ingress.tls.existingSecret.name }}
{{- else if eq .Values.ingress.tls.mode "manual" -}}
{{- default (printf "%s-tls" (include "rewind.fullname" .)) .Values.ingress.tls.manual.secretName }}
{{- end -}}
{{- end }}

