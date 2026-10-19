{{/*
UAI Platform — shared template helpers
*/}}

{{/*
Expand the name of the chart.
*/}}
{{- define "uai.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
Uses the release name so all resources share a common prefix.
*/}}
{{- define "uai.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "uai.labels" -}}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: uai
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end }}

{{/*
Selector labels (subset of common labels, used in matchLabels).
*/}}
{{- define "uai.selectorLabels" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
