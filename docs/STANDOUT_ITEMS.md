# Stand-Out Items Implementation & Repository Map

This document lists all stand-out items implemented in the **UAI MCP Platform**, detailing their architectural rationale, security guarantees, and exact file locations in the repository.

---

## Summary Matrix

| Stand-Out Item | Description | Status | Verification & Code Locations |
| :--- | :--- | :--- | :--- |
| **(a) Tool Permissions per Role** | Tools restricted by role (`admin` vs `member`). Sensitive tools are both hidden from `tools/list` and rejected with `[Gateway Forbidden]` on execution. | ✅ **Implemented & Verified** | `src/gateway/src/auth/permissions.ts`<br>`src/gateway/src/mcp/gateway-server.ts`<br>`src/gateway/src/agent/agent-core.ts`<br>`src/gateway/src/api/server-routes.ts`<br>`src/gateway/verify-phase8.js` |
| **(b) Security Hardening** | • SSRF Guard on upstream registration<br>• Zero-Trust NetworkPolicies<br>• 100% Non-Root Containers<br>• AES-256-GCM Credential Encryption<br>• Least-Privilege RBAC & Key Isolation | ✅ **Implemented & Verified** | `src/gateway/src/crypto/ssrf-guard.ts`<br>`uai/templates/network-policies.yaml`<br>`src/gateway/src/crypto/encryption.ts`<br>`src/gateway/src/auth/auth-service.ts`<br>`src/gateway/verify-phase8.js` |
| **(c) Observability & Metrics** | Prometheus metrics endpoint (`/metrics` & `/api/metrics`) with tool call counts, durations, upstream health gauges, active keys, and audit counters. | ✅ **Implemented & Verified** | `src/gateway/src/metrics/index.ts`<br>`src/gateway/src/index.ts`<br>`uai/templates/ingress.yaml`<br>`src/gateway/verify-phase8.js` |
| **(d) Upgrade / Rollback Runbook** | Documented and verified zero-downtime `helm upgrade` and `helm rollback` testing with replica scaling. | ✅ **Implemented & Verified** | `docs/UPGRADE_ROLLBACK.md`<br>`uai/charts/gateway/templates/deployment.yaml` |
| **(e) VPS Deployment on k3s** | Production configuration profile for k3s, Traefik ingress controller, nip.io / custom DNS, and production secret management. | ✅ **Configured & Documented** | `uai/values-prod.yaml`<br>`docs/DESIGN.md`<br>`README.md` |

---

## Detailed Item Breakdown & File Map

### 1. Item (a): Tool Permissions per Role
- **Goal:** Sensitive tools (such as product creation and order status modification) must only be accessible to administrative users. Regular members must neither discover them during exploration nor be able to execute them.
- **Repository Locations:**
  - [`src/gateway/src/auth/permissions.ts`](file:///C:/Users/harsh/Downloads/uai/src/gateway/src/auth/permissions.ts): Centralized RBAC policy registry defining `ADMIN_ONLY_TOOLS` (`woo__create_product`, `woo__update_order_status`) and permission check functions (`canUserAccessTool`, `getAccessDeniedMessage`).
  - [`src/gateway/src/mcp/gateway-server.ts`](file:///C:/Users/harsh/Downloads/uai/src/gateway/src/mcp/gateway-server.ts):
    - In `ListToolsRequestSchema` handler: filters tools with `canUserAccessTool(user, tool.name)` before returning to the MCP client.
    - In `CallToolRequestSchema` handler: checks `canUserAccessTool(user, name)`; returns `isError: true` with `[Gateway Forbidden]` if unauthorized.
  - [`src/gateway/src/agent/agent-core.ts`](file:///C:/Users/harsh/Downloads/uai/src/gateway/src/agent/agent-core.ts): Filters tools provided to the Autonomous Chat Agent's LLM context and prevents execution of restricted tools.
  - [`src/gateway/src/api/server-routes.ts`](file:///C:/Users/harsh/Downloads/uai/src/gateway/src/api/server-routes.ts): Filters tools returned on `GET /api/servers/tools` based on the requester's role.
- **Verification:**
  - Automated in [`src/gateway/verify-phase8.js`](file:///C:/Users/harsh/Downloads/uai/src/gateway/verify-phase8.js): Check 1 confirms Admin sees 11 tools while Member sees 9. Direct execution of `woo__create_product` by Member returns:
    ```json
    {
      "isError": true,
      "content": [{ "type": "text", "text": "[Gateway Forbidden] Role 'member' is not authorized to execute 'woo__create_product'. Required role: 'admin'." }]
    }
    ```

---

### 2. Item (b): Security Hardening

#### A. SSRF Protection
- **Goal:** Block attempts by admins or attackers to register upstream MCP URLs pointing to cloud metadata services, loopback interfaces, or cluster-internal services.
- **Repository Locations:**
  - [`src/gateway/src/crypto/ssrf-guard.ts`](file:///C:/Users/harsh/Downloads/uai/src/gateway/src/crypto/ssrf-guard.ts): Validates URL schemes, blocks cloud metadata (`169.254.169.254`, `metadata.google.internal`, `100.100.100.200`), loopback (`127.0.0.1`, `localhost`), link-local ranges, and Kubernetes control plane (`kubernetes.default`).
  - [`src/gateway/src/api/server-routes.ts`](file:///C:/Users/harsh/Downloads/uai/src/gateway/src/api/server-routes.ts): Integrates `validateUpstreamUrl(url)` into `POST /api/servers` and `PUT /api/servers/:id`.
- **Verification:**
  - Automated in [`src/gateway/verify-phase8.js`](file:///C:/Users/harsh/Downloads/uai/src/gateway/verify-phase8.js): Check 2 attempts 9 malicious payloads (AWS, GCP, Alibaba metadata, 127.0.0.1, localhost, link-local, kubernetes API, gopher, file schemes), all returning HTTP 400 Bad Request.

#### B. Zero-Trust NetworkPolicies
- **Goal:** Isolate backend datastores and upstream MCP servers from unauthorized cluster traffic.
- **Repository Locations:**
  - [`uai/templates/network-policies.yaml`](file:///C:/Users/harsh/Downloads/uai/uai/templates/network-policies.yaml):
    - `uai-postgres-netpol`: Only accepts port 5432 ingress from `app.kubernetes.io/name: gateway`.
    - `uai-mariadb-netpol`: Only accepts port 3306 ingress from `app.kubernetes.io/name: woocommerce`.
    - `uai-demo-mcp-netpol`: Only accepts ports 8001/8002 ingress from `app.kubernetes.io/name: gateway`.
  - [`uai/charts/woo-mcp/templates/networkpolicy.yaml`](file:///C:/Users/harsh/Downloads/uai/uai/charts/woo-mcp/templates/networkpolicy.yaml): Only accepts port 8000 ingress from `app.kubernetes.io/name: gateway`.
- **Verification:**
  - Automated in [`src/gateway/verify-phase8.js`](file:///C:/Users/harsh/Downloads/uai/src/gateway/verify-phase8.js): Check 4 verifies all 4 NetworkPolicies active.

#### C. Non-Root Containers & Probes (Rule 5 Compliance)
- **Goal:** Zero containers run as root; all have resource requests/limits and liveness/readiness probes.
- **Repository Locations:**
  - All chart deployment specs: MariaDB (`runAsUser: 999`), WordPress (`runAsUser: 33`), Postgres (`runAsUser: 70`), Gateway (`runAsUser: 1000`), woo-mcp (`runAsUser: 1000`), dashboard (`nginxinc/nginx-unprivileged` on port 8080, `runAsUser: 101`).
- **Verification:**
  - Verified in [`src/gateway/verify-phase7.js`](file:///C:/Users/harsh/Downloads/uai/src/gateway/verify-phase7.js) across all 8 pods.

#### D. AES-256-GCM Credential Encryption
- **Goal:** Upstream credentials are encrypted at rest with authenticated encryption and never returned over any API.
- **Repository Locations:**
  - [`src/gateway/src/crypto/encryption.ts`](file:///C:/Users/harsh/Downloads/uai/src/gateway/src/crypto/encryption.ts)

---

### 3. Item (c): Observability & Prometheus Metrics
- **Goal:** Export standard Prometheus exposition metrics for monitoring upstream health, tool usage, latency, and system load.
- **Repository Locations:**
  - [`src/gateway/src/metrics/index.ts`](file:///C:/Users/harsh/Downloads/uai/src/gateway/src/metrics/index.ts): Metrics registry with `recordToolCall` and gauge scrapers.
  - [`src/gateway/src/index.ts`](file:///C:/Users/harsh/Downloads/uai/src/gateway/src/index.ts): Serves `/metrics` and `/api/metrics`.
  - [`uai/templates/ingress.yaml`](file:///C:/Users/harsh/Downloads/uai/uai/templates/ingress.yaml): Maps `/metrics` path directly through the Ingress controller.
- **Metrics Exported:**
  - `mcp_gateway_tool_calls_total{server, tool, outcome}`
  - `mcp_gateway_tool_call_duration_seconds_total{server, tool, outcome}`
  - `mcp_gateway_upstream_status{server, status, enabled}`
  - `mcp_gateway_active_api_keys`
  - `mcp_gateway_registered_users`
  - `mcp_gateway_audit_records_total`
- **Verification:**
  - Automated in [`src/gateway/verify-phase8.js`](file:///C:/Users/harsh/Downloads/uai/src/gateway/verify-phase8.js): Check 3 fetches `http://app.localtest.me/metrics` and validates format and values.

---

### 4. Item (d): Upgrade / Rollback Runbook
- **Goal:** Safe, zero-downtime upgrades and rollbacks documented and tested once against the live cluster.
- **Repository Locations:**
  - [`docs/UPGRADE_ROLLBACK.md`](file:///C:/Users/harsh/Downloads/uai/docs/UPGRADE_ROLLBACK.md): Step-by-step operator guide with recorded outputs from Revision 9 -> 11 (`gateway.replicaCount=2`) -> 12 (rollback to 9).
  - [`uai/charts/gateway/templates/deployment.yaml`](file:///C:/Users/harsh/Downloads/uai/uai/charts/gateway/templates/deployment.yaml): Parameterized `replicas: {{ .Values.replicaCount | default 1 }}`.

---

### 5. Item (e): VPS Deployment Configuration on k3s
- **Goal:** Production Helm configuration separating local development (`values-local.yaml` + `ingress-nginx` + `localtest.me`) from VPS production (`values-prod.yaml` + `traefik` + nip.io / custom domain).
- **Repository Locations:**
  - [`uai/values-prod.yaml`](file:///C:/Users/harsh/Downloads/uai/uai/values-prod.yaml): Uses Traefik ingress class, production domains, standard storage classes, and secret references.
  - [`README.md`](file:///C:/Users/harsh/Downloads/uai/README.md): Production deployment guide.
  - [`docs/DESIGN.md`](file:///C:/Users/harsh/Downloads/uai/docs/DESIGN.md): Local vs Prod parity architecture analysis.
