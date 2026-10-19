# Setup script for UAI platform (PowerShell)
# Usage: .\setup.ps1

$ErrorActionPreference = "Stop"
$CLUSTER_NAME = "uai"

Write-Host "=== UAI Platform Setup ===" -ForegroundColor Cyan

# 1. Check prerequisites
Write-Host "`n[1/5] Checking prerequisites..." -ForegroundColor Yellow
foreach ($cmd in @("docker", "kind", "helm", "kubectl")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "  ERROR: $cmd not found. Please install it first." -ForegroundColor Red
        exit 1
    }
    Write-Host "  OK: $cmd" -ForegroundColor Green
}

# Check Docker daemon
docker info > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Docker daemon is not running. Start Docker Desktop first." -ForegroundColor Red
    exit 1
}
Write-Host "  OK: Docker daemon running" -ForegroundColor Green

# 2. Create kind cluster (skip if exists)
Write-Host "`n[2/5] Creating kind cluster '$CLUSTER_NAME'..." -ForegroundColor Yellow
$existing = kind get clusters 2>$null | Where-Object { $_ -eq $CLUSTER_NAME }
if ($existing) {
    Write-Host "  Cluster '$CLUSTER_NAME' already exists, skipping." -ForegroundColor Green
} else {
    kind create cluster --name $CLUSTER_NAME --config kind-config.yaml
    Write-Host "  Cluster created." -ForegroundColor Green
}

# 3. Set kubectl context
Write-Host "`n[3/5] Setting kubectl context..." -ForegroundColor Yellow
kubectl cluster-info --context "kind-$CLUSTER_NAME"

# 4. Install ingress-nginx
Write-Host "`n[4/5] Installing ingress-nginx..." -ForegroundColor Yellow
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
Write-Host "  Waiting for ingress-nginx controller to be ready (up to 120s)..."
kubectl -n ingress-nginx wait --for=condition=ready pod -l app.kubernetes.io/component=controller --timeout=120s
Write-Host "  ingress-nginx ready." -ForegroundColor Green

# 5. Helm install
Write-Host "`n[5/5] Installing UAI platform via Helm..." -ForegroundColor Yellow
Push-Location (Split-Path $MyInvocation.MyCommand.Path)
helm dependency build ./uai
helm install uai ./uai -f ./uai/values-local.yaml -n uai --create-namespace
Pop-Location
Write-Host "  Helm release installed." -ForegroundColor Green

Write-Host "`n=== Setup complete ===" -ForegroundColor Cyan
Write-Host "Store:     http://store.localtest.me"
Write-Host "Dashboard: http://app.localtest.me"
Write-Host "Gateway:   http://app.localtest.me/api"
