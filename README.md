# UAI — MCP Gateway & Orchestration Platform on Kubernetes

> A production-grade Model Context Protocol (MCP) gateway, WooCommerce e-commerce engine, administration dashboard, and autonomous AI chat agent running entirely on Kubernetes.

---

## Architecture Overview

```
                      Browser / MCP Client (Cursor / Claude Code)
                                       │
                                       ▼
                       Ingress Controller (hostPort 80/443)
                         *.localtest.me (resolves 127.0.0.1)
                                       │
              ┌────────────────────────┴────────────────────────┐
              │                                                 │
              ▼                                                 ▼
     http://store.localtest.me                      http://app.localtest.me
   ┌──────────────────────────┐                    ┌─────────────────────────┐
   │     uai-woocommerce      │                    │      uai-dashboard      │
   │  WordPress 6.4 + Woo 8.5 │                    │  React + Vite + Tailwind│
   │  Apache (UID 33, 2Gi)    │                    │  Nginx non-root (UID 101│
   └──────────┬───────────────┘                    └─────────────────────────┘
              │                                                 │ /api, /mcp
              ▼                                                 ▼
   ┌──────────────────────────┐                    ┌─────────────────────────┐
   │      uai-mariadb-0       │                    │       uai-gateway       │
   │  MariaDB 11.2 (UID 999)  │                    │  Streamable HTTP (SSE)  │
   │  1Gi PVC (Persistent)    │                    │  Tool Aggregator (3000) │
   └──────────────────────────┘                    └───────┬─────────┬───────┘
                                                           │         │
                   ┌───────────────────────────────────────┴───┐     ▼
                   │                                           │  ┌───────────────┐
                   ▼                                           ▼  │ uai-postgres  │
        ┌──────────────────────┐                    ┌──────────┐  │ PostgreSQL 16 │
        │     uai-woo-mcp      │                    │ uai-demo │  │ (Audit & Keys)│
        │  ClusterIP (Port 8000│                    │ servers  │  └───────────────┘
        │  - NetworkPolicy     │                    │ - utils  │
        │  - 5 Woo Store Tools │                    │ - every  │
        └──────────┬───────────┘                    └──────────┘
                   │ REST API v3
                   ▼
              WooCommerce
```

---

## Quick Start (Local Development on kind)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [kind](https://kind.sigs.k8s.io/) (`winget install Kubernetes.kind`)
- [Helm](https://helm.sh/) (`winget install Helm.Helm`)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- Node.js 20+

### 1. Provision kind Cluster with Host Port Mappings
```bash
kind create cluster --name uai --config kind-config.yaml
```

### 2. Deploy Ingress-Nginx Controller
```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace \
  --set controller.hostPort.enabled=true \
  --set-string controller.nodeSelector.ingress-ready="true" \
  --set controller.tolerations[0].key="node-role.kubernetes.io/control-plane" \
  --set controller.tolerations[0].operator="Equal" \
  --set controller.tolerations[0].effect="NoSchedule"
kubectl -n ingress-nginx wait --for=condition=ready pod -l app.kubernetes.io/component=controller --timeout=120s
```

### 3. Build & Load Container Images
```bash
# Build images
docker build -t uai-woo-mcp:latest src/woo-mcp
docker build -t uai-utils-mcp:latest src/utils-mcp
docker build -t uai-everything-mcp:latest src/everything-mcp
docker build -t uai-gateway:latest src/gateway
docker build -t uai-dashboard:latest src/dashboard

# Load into kind
kind load docker-image uai-woo-mcp:latest uai-utils-mcp:latest uai-everything-mcp:latest uai-gateway:latest uai-dashboard:latest --name uai
```

### 4. Configure LLM Provider & Secret Management
The autonomous chat agent supports real OpenAI-compatible LLM providers (e.g. Groq, OpenAI). Non-secret provider parameters are configured declaratively in Helm values (`values-local.yaml` / `values-prod.yaml`), while API keys reside strictly inside Kubernetes Secrets:

```bash
# Create the LLM secret in the uai namespace (only the key is stored in the secret; never in git)
kubectl -n uai create secret generic uai-llm --from-literal=llm-api-key=YOUR_GROQ_OR_OPENAI_KEY
```

Configure non-sensitive provider and model identifiers in `uai/values-local.yaml`:
```yaml
gateway:
  env:
    llmProvider: "groq"
    llmModel: "openai/gpt-oss-120b"
```

### 5. Deploy Platform via Helm
```bash
helm install uai ./uai -f ./uai/values-local.yaml -n uai --create-namespace
```

---

## Service Endpoints & Access

| **Component** | **URL** | **Notes** |
|---|---|---|
| **WooCommerce Storefront** | [http://store.localtest.me](http://store.localtest.me) | Pre-seeded with catalog products and COD checkout |
| **WordPress Admin** | [http://store.localtest.me/wp-login.php](http://store.localtest.me/wp-login.php) | User: `admin` / Password: see Secrets Retrieval below |
| **UAI Dashboard** | [http://app.localtest.me](http://app.localtest.me) | Admin: `admin@localtest.me` / Password: see Secrets Retrieval below |
| **Gateway REST API** | [http://app.localtest.me/api](http://app.localtest.me/api) | Protected by JWT session cookie or Bearer tokens |
| **Gateway Streamable MCP** | [http://app.localtest.me/mcp](http://app.localtest.me/mcp) | Modern Streamable HTTP endpoint (`Bearer gw_...`) |
| **Prometheus Metrics** | Internal port `9090` / Admin `/api/metrics` | Prometheus metrics exporter (unauthenticated public /metrics removed) |

### Secrets Retrieval
Retrieve dynamically generated credentials from the Kubernetes Secret:
```bash
# Admin Email
kubectl get secret -n uai uai-gateway -o jsonpath="{.data.admin-email}" | base64 -d; echo

# Admin Password
kubectl get secret -n uai uai-gateway -o jsonpath="{.data.admin-password}" | base64 -d; echo
```

---

## How to Place an Order
To test the full WooCommerce order lifecycle and external MCP order queries:
1. **Browse Storefront**: Open [http://store.localtest.me](http://store.localtest.me) in your browser.
2. **Add Products to Cart**: Select any product (e.g. *Premium Quality Hoodie*) and click **Add to cart**.
3. **Navigate to Checkout**: Click the cart or go directly to [http://store.localtest.me/checkout](http://store.localtest.me/checkout).
4. **Complete Checkout (Cash on Delivery)**: Enter demo billing details (e.g. John Doe, demo street, city). Select **Cash on delivery (COD)** as the payment method to bypass payment gateways, and click **Place order**.
5. **Confirm in WP-Admin**: Log into [http://store.localtest.me/wp-login.php](http://store.localtest.me/wp-login.php) with the admin credentials. Go to **WooCommerce -> Orders** to see the new order in `processing` status.
6. **Query via MCP**: Query orders via an external MCP client (`woo__list_orders`) or ask the dashboard AI chat agent (*"What orders were placed today?"*).

---

## Connecting External MCP Clients

### 1. Cursor IDE (`mcp.json`)
Open Cursor Settings -> Features -> MCP Servers -> **Add MCP Server**:
```json
{
  "mcpServers": {
    "uai-gateway": {
      "url": "http://app.localtest.me/mcp",
      "headers": {
        "Authorization": "Bearer gw_YOUR_API_KEY_HERE"
      }
    }
  }
}
```

### 2. Claude Code CLI
```bash
claude mcp add uai-gateway -- \
  http://app.localtest.me/mcp \
  --header "Authorization: Bearer gw_YOUR_API_KEY_HERE"
```

### 3. MCP Inspector
```bash
npx @modelcontextprotocol/inspector http://app.localtest.me/mcp \
  --header "Authorization: Bearer gw_YOUR_API_KEY_HERE"
```

---

## Using the Autonomous Chat Agent

1. Open the Dashboard at **[http://app.localtest.me](http://app.localtest.me)**.
2. Sign in with the **Quick Demo Fill** (`admin@localtest.me`).
3. Navigate to the **Chat Agent** tab.
4. Try sample instructions:
   - `"create a product Wireless Mechanical Keyboard at 499"`: The agent analyzes your instruction, triggers `woo__create_product`, publishes the product to the store catalog, and provides the live link (`http://store.localtest.me/product/...`).
   - `"what orders came in today"`: The agent analyzes the store's configured timezone (`Asia/Kolkata`), calls `woo__list_orders` with the precise start-of-day boundary (`after: 2026-10-21T00:00:00+05:30`), and summarizes all customer orders and totals.
   - `"get today's orders, then convert the total to EUR"`: Demonstrates real multi-turn sequential tool orchestration (`woo__list_orders` -> extracts total -> passes argument to `utils__convert_currency`).

### Resilience, Rate Limiting & Fallback Amber Banner
- **Automated Retry & Backoff**: Upstream provider HTTP 429 (rate limit) or 5xx errors trigger automatic exponential backoff (up to 3 retries) with a visible real-time notification (`⏳ Rate limited by upstream provider, retrying in Ns...`) broadcast to the UI.
- **Strict Argument Validation**: If an LLM returns malformed or unparseable JSON arguments, write tools are never executed with `{}` or guessed inputs; the error is fed back to the model for correction (up to 2 retries).
- **Amber Fallback Banner**: If the LLM provider key is missing, invalid, or fails persistently across retries, the agent safely switches to the local deterministic mock fallback model to maintain platform availability. The dashboard chat UI renders an amber warning banner:
  > **⚠️ Fallback Model Active** — Live LLM is currently unreachable. Autonomous tool execution is operating in mock fallback mode. Verify your `uai-llm` secret.

---

## Production Deployment (k3s on VPS)

1. **Install k3s on Ubuntu / Debian**:
   ```bash
   curl -sfL https://get.k3s.io | sh -
   ```
2. **Point your DNS records** (e.g. `store.yourdomain.com` and `app.yourdomain.com`) to the VPS Public IP (or use `<vps-ip>.nip.io`).
3. **Deploy using `values-prod.yaml`**:
   ```bash
   helm install uai ./uai -f ./uai/values-prod.yaml -n uai --create-namespace
   ```
   *`values-prod.yaml` uses Traefik as the default ingress class, binds real domains, configures Ingress TLS with cert-manager annotations, and sets persistent PVCs.*

> [!NOTE]
> **Production Validation Status**: `values-prod.yaml` (configured with Traefik ingress class and cert-manager TLS) was validated via `helm lint` and `helm template` only. It was not deployed to a live k3s or k3d cluster during this assignment audit (the live cluster under test is the local Kind development cluster). For live production deployments on k3s, Traefik is enabled by default, and cert-manager must be installed to issue the configured TLS certificates.
>
> **Helm Lookup Limitation**: Helm's built-in `lookup` function queries secrets from a live Kubernetes API during `helm install` / `helm upgrade`. During offline `helm template` dry-runs or linting, `lookup` returns empty by design and generates fresh random secrets. In live cluster operations, existing Secrets annotated with `helm.sh/resource-policy: keep` are preserved across upgrades.

---

## Comprehensive Automated Verification Test Suites

Run any of the end-to-end verification suites from the repository root:

```bash
# 1. Verify woo-mcp standalone tools (Phase 3)
node src/woo-mcp/verify.js

# 2. Verify Gateway aggregation, namespacing, and collision handling (Phase 4)
node src/gateway/verify-phase4.js

# 3. Verify Fault Tolerance & Resilience during upstream outage (Phase 4)
node src/gateway/verify-resilience.js

# 4. Verify Dashboard static serving, security, and RBAC (Phase 5)
node src/dashboard/verify-phase5.js

# 5. Verify Autonomous Chat Agent tool loop & user attribution (Phase 6)
node src/gateway/verify-phase6.js

# 6. Verify Full Definition-of-Done Multi-User Rehearsal (Phase 7)
node src/gateway/verify-phase7.js

# 7. Verify Stand-Out Items & Security Hardening (Phase 8)
node src/gateway/verify-phase8.js
```

---

## Documentation Index

- **[DECISIONS.md](docs/DECISIONS.md)**: Comprehensive architectural decision log (D-001 through D-037).
- **[STANDOUT_ITEMS.md](docs/STANDOUT_ITEMS.md)**: Stand-out items implementation details, security analysis, and repository map.
- **[UPGRADE_ROLLBACK.md](docs/UPGRADE_ROLLBACK.md)**: Zero-downtime Helm upgrade and rollback runbook with live test proof.
- **[DESIGN.md](docs/DESIGN.md)**: Deep dive into aggregation, routing, namespacing, and local vs prod parity.
- **[THREAT_MODEL.md](docs/THREAT_MODEL.md)**: Security analysis, credential isolation, prompt injection defenses, and cross-user boundaries.
- **[DEMO.md](docs/DEMO.md)**: Step-by-step presentation and demo script.
