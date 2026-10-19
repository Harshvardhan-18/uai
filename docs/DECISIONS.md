# UAI — Decisions Log

Running log of architectural and implementation choices.

---

## Phase 1 — Cluster & Helm Skeleton

### D-001: Own subcharts instead of Bitnami
**Context:** MariaDB, WordPress, and PostgreSQL all have popular Bitnami Helm charts.
**Decision:** Write our own minimal subcharts (~20-line templates each).
**Why:** Full control over probes, securityContext, resource limits, and the WooCommerce bootstrap Job. Every template line must be explainable in a live demo. Bitnami charts have 200+ values with opaque internal logic that would be hard to reason about during Q&A.
**Trade-off:** We own the maintenance, but for a demo project the scope is bounded.

### D-002: Single Ingress in umbrella chart
**Context:** Each subchart could define its own Ingress, or we can have one central Ingress.
**Decision:** One Ingress template in `uai/templates/ingress.yaml`.
**Why:** One place to see every routing rule. Switching ingress class (nginx ↔ traefik) is a single value. No risk of annotation conflicts between subcharts.

### D-003: *.localtest.me for local domains
**Context:** Local dev needs hostnames for Ingress routing but editing /etc/hosts is fragile.
**Decision:** Use `*.localtest.me` (public DNS that resolves to 127.0.0.1).
**Why:** Zero setup, works on every OS, multiple subdomains (`store.`, `app.`), and kind's port mappings make host port 80 reach ingress-nginx directly.

### D-004: kind port mappings (80/443)
**Context:** Accessing services in kind usually requires `kubectl port-forward` or NodePort.
**Decision:** Map host 80→container 80 and 443→443 on the control-plane node.
**Why:** Combined with localtest.me, the browser can reach `http://store.localtest.me` with zero manual steps. Same UX as the VPS (just different domains).

### D-005: Single namespace (uai)
**Context:** Could use one namespace per component or one shared namespace.
**Decision:** Everything in the `uai` namespace.
**Why:** Simpler RBAC, easier `kubectl` commands during the demo, NetworkPolicies still enforce pod-level isolation where needed.

### D-006: Chart named "uai" (renamed from mcp-platform)
**Context:** User requested the main application be called UAI.
**Decision:** Umbrella chart is `uai/`, release name `uai`, namespace `uai`.

### D-007: winget for kind + helm installation
**Context:** Need kind and helm on Windows.
**Decision:** `winget install Kubernetes.kind` and `winget install Helm.Helm`.
**Why:** User has winget available. Simpler than manual binary downloads, auto-adds to PATH.

### D-008: docker build + kind load (no registry)
**Context:** Custom images need to be available inside the kind cluster.
**Decision:** Build with `docker build`, load with `kind load docker-image`.
**Why:** No registry to run or configure. Images are pushed directly into the kind node's containerd store. Simple, fast, offline-friendly.

### D-009: Ingress-Nginx via official Helm chart with hostPort & ingress-ready selector
**Context:** Need ingress controller in kind cluster that binds to mapped host ports 80 and 443.
**Decision:** Installed `ingress-nginx/ingress-nginx` via Helm with `controller.hostPort.enabled=true`, `controller.nodeSelector."ingress-ready"="true"`, and tolerations.
**Why:** Helm repo installation is reliable, declarative, and directly integrates with kind's `extraPortMappings` without requiring external manifest curl dependencies.

---

## Phase 2 — WooCommerce with Persistence & Automated Bootstrap

### D-010: MariaDB StatefulSet with volumeClaimTemplates (1Gi PVC)
**Context:** WooCommerce needs persistent relational storage for users, catalog, settings, and orders.
**Decision:** Deploy MariaDB 11.2 as a single-replica StatefulSet with `volumeClaimTemplates` mounting a 1Gi ReadWriteOnce PVC to `/var/lib/mysql`.
**Security Context:** Runs as non-root UID 999 (mysql user) with GID 999 and `fsGroup: 999`, dropping all capabilities.
**Probes:** Exec readiness & liveness probes using `mariadb-admin ping`.

### D-011: WordPress Deployment with PVC Mount & Non-Root Capabilities
**Context:** WordPress core, uploaded media, and installed plugins need to persist across pod restarts while adhering to non-root security rules.
**Decision:** WordPress deployment mounts a 2Gi PVC to `/var/www/html` with `fsGroup: 33` (www-data).
**Security Context:** Runs as non-root UID 33 (www-data) with capability `NET_BIND_SERVICE` added so Apache can bind to port 80 without root privileges, while dropping all other capabilities.
**Probes:** HTTP GET readiness and liveness probes against `/wp-login.php`.

### D-012: Automated Bootstrap Job via WP-CLI
**Context:** WooCommerce setup traditionally requires interactive wizard clicks to install plugins, set permalinks, enable payment gateways, and generate API credentials.
**Decision:** A Kubernetes batch Job (`wordpress:cli`) mounts the PVC, waits for MariaDB readiness, and executes an automated setup script:
1. Installs WordPress core with admin credentials.
2. Installs and activates the WooCommerce plugin.
3. Sets rewrite structure to `/%postname%/` (mandatory for WooCommerce REST API v3 routes).
4. Configures Cash on Delivery (COD) payment method in `woocommerce_cod_settings`.
5. Pre-seeds 2 demo catalog products for immediate testing.
6. Writes the REST API consumer key and secret directly into `wp_woocommerce_api_keys` using `hash_hmac('sha256', key, 'wc-api')`.

### D-013: REST API Keys Synchronized with Kubernetes Secret
**Context:** The upcoming `woo-mcp` service needs credentials to interact with WooCommerce without requiring manual copy-pasting.
**Decision:** Helm generates a Kubernetes Secret (`uai-woo-credentials`) containing consumer key, consumer secret, and service URL. The bootstrap Job reads the exact same secret and registers the key in WooCommerce DB.
**Why:** Zero manual steps, reproducible across cluster rebuilds, strictly adheres to Rule 3 (no secrets hardcoded in git).

### D-014: SSL Emulation (`$_SERVER['HTTPS'] = 'on';`) for Ingress & Internal REST API
**Context:** WooCommerce REST API v3 enforces SSL for Basic Authentication (`ck_...` / `cs_...`). Without SSL, it expects OAuth 1.0a signatures and rejects requests with `401 woocommerce_rest_cannot_view`.
**Decision:** Configured `$_SERVER['HTTPS'] = 'on';` in `wp-config.php`.
**Why:** Allows the REST API to accept Basic Auth securely behind reverse proxies (Ingress) and for cluster-internal service-to-service calls (woo-mcp -> woocommerce) where TLS termination happens at the edge.

---

## Phase 3 — woo-mcp MCP Server (Streamable HTTP, Tools, NetworkPolicy)

### D-015: Streamable HTTP (SSE) Transport via Official @modelcontextprotocol/sdk
**Context:** Need an MCP server implementation in TypeScript that can scale statelessly and integrate with the Gateway.
**Decision:** Used `McpServer` and `SSEServerTransport` from `@modelcontextprotocol/sdk` mounted on Express (`GET /sse` and `POST /messages`).
**Why:** Official, standard protocol implementation, native support for SSE streaming, multi-session tracking via session ID, and standard JSON-RPC 2.0.

### D-016: WooCommerce Integration via REST API v3 over Pod Exec or Direct DB
**Context:** woo-mcp needs to query and update WooCommerce data.
**Decision:** All interactions go through WooCommerce REST API v3 (`/wp-json/wc/v3/*`) authenticated via Basic Auth with consumer key/secret.
**Why:**
1. **Stability & Documentation:** REST API v3 is official, versioned, and documented.
2. **Business Logic & Validation:** Ensures WooCommerce actions, filters, tax calculations, stock management, and status transition hooks are triggered properly. Direct DB edits bypass these hooks and risk corrupting postmeta.
3. **Least Privilege & Security:** Eliminates the need for Kubernetes API privileges (no `kubectl exec` into WordPress pods).
4. **Environment Parity:** Works identically in local kind and remote VPS environments.

### D-017: woo-mcp ClusterIP & NetworkPolicy Isolation
**Context:** woo-mcp exposes store management tools and must not be directly accessible by external clients or arbitrary cluster workloads.
**Decision:** Expose woo-mcp via a `ClusterIP` Service only (no Ingress rule). Deploy a Kubernetes `NetworkPolicy` restricting ingress traffic on port 8000 exclusively to pods labeled `app.kubernetes.io/name: gateway`.
**Why:** Zero-trust cluster networking. External clients must traverse the MCP Gateway where authentication, authorization, and auditing occur.

---

## Phase 4 — Gateway Core (DB, Aggregation, Namespacing, API Keys, Resilience, Audit)

### D-018: Tool Namespacing (`<serverSlug>__<toolName>`) to Eliminate Collisions
**Context:** Multiple upstream MCP servers may expose identically named tools (e.g. `utils-mcp` and `everything-mcp` both export `echo`). Exposing them directly causes schema collisions and undefined routing in LLMs.
**Decision:** Gateway prefixes every upstream tool as `<serverSlug>__<toolName>` (sanitized to `^[a-zA-Z0-9_-]{1,64}$` for LLM compliance). On tool call, the gateway parses the prefix before the double underscore `__` to identify the target upstream and routes the raw tool name to that server.
**Why:** Collisions become mathematically impossible. LLMs receive a distinct namespace per tool, and routing is deterministic without modifying upstream servers.

### D-019: AES-256-GCM Encryption at Rest for Upstream Credentials
**Context:** Upstream servers may require bearer tokens, API keys, or custom headers. These secrets must be stored in PostgreSQL for dynamic CRUD.
**Decision:** All upstream server credentials are encrypted before insertion using AES-256-GCM with a 256-bit key injected from a Kubernetes Secret (`uai-gateway-secrets`), producing a base64 payload containing `iv:authTag:ciphertext`. No API response ever returns credentials or decrypts them outside the tool-call routing pipeline.
**Why:** Protects credentials at rest against database dumps, accidental logs, and unauthorized dashboard reads.

### D-020: Resilience Architecture (Promise.allSettled, Timeouts, Health Status, Tool Caching)
**Context:** Upstream MCP servers can become slow, crash, or be scaled down. The gateway must remain responsive and must not fail globally if one server goes down.
**Decision:**
1. Upstream tool discovery runs concurrently via `Promise.allSettled` with an upstream timeout of 5 seconds.
2. Tool execution has an isolated 30-second timeout per call.
3. Successfully resolved tool definitions are cached in memory with a 60-second TTL to avoid pounding upstreams on every client list request.
4. A background health check runner periodically pings `/sse` on each server and marks status as `Connected`, `Unreachable`, or `Disabled`, storing error reasons in Postgres.
5. If an upstream is down, its own tool calls return a structured error (`[Gateway Error] ...`) while all other upstreams continue functioning normally.

### D-021: API Key Security Model (`gw_` prefix, SHA-256 storage, Instant Revocation)
**Context:** External MCP clients (Claude Code, Cursor, MCP Inspector) need persistent credentials to authenticate to `/mcp`.
**Decision:**
1. Keys are generated as `gw_` followed by 32 cryptographically secure random bytes (hex).
2. The raw key is displayed to the user exactly once at creation time and never stored in plain text.
3. The database stores only the SHA-256 hash, creation timestamp, key prefix, and revocation status.
4. Revocation is an immediate soft-delete (`revoked_at = NOW()`) checked synchronously on every incoming request. Revoked keys are rejected on the very next call with HTTP 401.

### D-022: Audit Logging with Strict Credential & Secret Redaction
**Context:** Security compliance requires recording every `tools/call`, who initiated it, and the execution outcome, without leaking sensitive parameters.
**Decision:**
1. The gateway logs user ID, email, server slug, tool name, start/end duration in ms, outcome (`success`, `error`, `timeout`), and any error messages to an `audit_logs` table.
2. Before writing parameters to the database, a recursive sanitizer (`sanitizeArgs`) scans argument objects and replaces values for any keys matching sensitive terms (`password`, `token`, `secret`, `key`, `authorization`, `auth`, `apiKey`) with `[REDACTED]`.
3. Upstream credentials are injected into upstream requests by the gateway pool and never passed into user audit logs or exposed in tool arguments.

### D-023: Raw Protocol Forwarding via `@modelcontextprotocol/sdk/server`
**Context:** Using the high-level `McpServer.tool()` helper stripped input schemas and parameters when aggregating tools dynamically without pre-compiled Zod schemas.
**Decision:** Used the lower-level `Server` class from `@modelcontextprotocol/sdk/server/index.js` with `setRequestHandler(ListToolsRequestSchema, ...)` and `setRequestHandler(CallToolRequestSchema, ...)` directly.
**Why:** Accurately preserves upstream JSON Schema definitions (`inputSchema`) and passes raw JSON arguments directly through to upstreams without losing fields or failing Zod validations.

---

## Phase 5 — Dashboard (React + Vite + Tailwind, Static Serving, Security, RBAC)

### D-024: React + Vite + Tailwind SPA Architecture
**Context:** Need a fast, responsive dashboard for managing upstreams, team members, personal API keys, audit logs, and testing agent chat.
**Decision:** Built using React 19, TypeScript, Vite, and Tailwind CSS. Built as a single-page application (SPA) with tabbed navigation and deep state binding.
**Why:** Extremely fast build times, lightweight bundle (~286 KB JS gzip 83 KB), zero runtime server dependencies for frontend assets, and predictable deployment.

### D-025: Static Serving via Unprivileged Nginx (`UID 101`) on Port 8080
**Context:** Rule 5 mandates non-root execution, probes, and resource constraints for every Kubernetes workload. Standard Nginx runs as root to bind port 80.
**Decision:** Multi-stage Dockerfile builds the static bundle in Node 20 alpine, then serves via `nginxinc/nginx-unprivileged:alpine` running as user `nginx` (`UID 101`, `GID 101`) listening on port 8080 with all capabilities dropped (`drop: ["ALL"]`). The Kubernetes Service maps external port 80 to container port 8080.
**Why:** Completely satisfies Kubernetes non-root security standards while Ingress routes requests transparently without requiring `NET_BIND_SERVICE`.

### D-026: Strict Credential Masking Across Frontend & APIs
**Context:** Admins configure upstream server credentials (bearer tokens or custom headers). These credentials must never leak to browsers or API consumers.
**Decision:**
1. Upstream tokens are write-only from the UI: inputs accept a token upon creation or optional rotation upon edit, but existing tokens are never prefilled or returned.
2. The REST API omits `auth_token_encrypted` from all SELECT and RETURNING queries.
3. API key generation returns raw key `gw_...` only once at generation time with a copy button; afterwards only prefix `gw_...` is queryable.
4. Audit log parameters are scrubbed via `sanitizeArgs` before display.

### D-027: Role-Based Access Control (RBAC) Enforcement
**Context:** Team members and admins share the dashboard but require different permission levels.
**Decision:**
1. **Admins:** Can register, edit, toggle, and delete upstream servers; invite/create team members; revoke any organization key; and inspect the full organization audit log.
2. **Members:** Restricted from server management and team administration (API blocks with HTTP 403 Forbidden); can view servers and tools list; generate and revoke their own personal API keys; and inspect their own audit logs and chat.

---

## Phase 6 — Chat Agent (SSE Streaming, LLM Abstraction, Tool Execution, Attribution)

### D-028: In-Process Agent Tool Execution with Direct User Identity Attribution
**Context:** When the chat agent invokes tools on behalf of a user, those executions must be audited under the user's authenticated identity rather than an anonymous or system account.
**Decision:** The agent loop calls `executeToolAsUser(user, toolName, args)` directly into the gateway core pool. Every invocation records the authenticated user's ID and email, tool name, execution duration in milliseconds, outcome, and sanitized arguments into the `audit_logs` table.
**Why:** Guarantees end-to-end accountability and compliance for autonomous agent actions, reusing the exact same routing and credential pipeline as external clients.

### D-029: LLM Provider Abstraction (Gemini, Groq, and SmartIntent Fallback)
**Context:** The gateway needs to support cloud LLMs (Gemini, Groq) via API keys in Kubernetes secrets while remaining 100% functional, testable, and demonstrable in air-gapped or offline development environments.
**Decision:** Created a unified `LLMProvider` interface with adapters for:
1. `GeminiProvider`: Google Gemini API (`gemini-1.5-flash`).
2. `OpenAICompatibleProvider`: Groq (`llama-3.3-70b-versatile`) or Ollama.
3. `SmartIntentProvider`: Deterministic regex/intent parser that extracts commands ("create a product X at 499", "what orders came in today", "echo ...", "convert ... to EUR") and generates function calls following the exact same tool loop protocol.
**Why:** Zero configuration required for instant verification and CI, while cloud keys seamlessly activate advanced LLM reasoning when provided in Kubernetes Secrets.

### D-030: SSE Streaming Protocol for Real-Time Tool Execution Visualization
**Context:** Users need immediate feedback on what the agent is thinking, which tools are being called, and the intermediate outputs before the final answer arrives.
**Decision:** Mounted `POST /api/chat` as a Server-Sent Events (SSE) stream emitting typed JSON events:
- `thought`: Internal agent reasoning state.
- `tool_call_start`: Tool name and input arguments.
- `tool_call_end`: Tool execution result and error status.
- `delta` / `done`: Final markdown text answer.
**Why:** Enables the UI to display live collapsible tool execution cards with input arguments and output payloads directly beneath the assistant message.

### D-031: Persistent Relational Chat Storage in PostgreSQL
**Context:** Conversations and tool invocation histories must persist across page refreshes and browser sessions.
**Decision:** Created relational `chat_sessions` and `chat_messages` tables linked to the `users` table via foreign keys with cascade deletion.
**Why:** Ensures conversations are private per user, audit-linked, and restorable across browser sessions.

---

## Phase 7 — Definition-of-Done Rehearsal (2-User Audit, Security Boundaries & Resilience)

### D-032: Multi-User Rehearsal & Security Boundary Verification
**Context:** The core platform must be validated end-to-end against all assignment requirements using two distinct identities (Admin & Member) before proceeding to any bonus features.
**Decision:** Executed an automated 9-point definition-of-done rehearsal (`src/gateway/verify-phase7.js`):
1. **Admin Full Capability**: Server discovery, server CRUD (zero token leakage), key generation, audit visibility.
2. **Member RBAC Enforcement**: Negative testing verified that member attempts to add/delete servers, view team members, or invite users are strictly rejected with HTTP 403 Forbidden.
3. **Key & Audit Isolation**: Members can only view their own API keys, cannot revoke Admin keys, and can only see audit records generated by their own account.
4. **Member MCP Execution**: Member connected external client over Streamable HTTP, executed tools, and had tool invocations correctly attributed in the central audit log.
5. **Immediate Key Revocation**: When revoked, subsequent client requests fail immediately with HTTP 401.
6. **Chat Agent Attribution**: Tool invocations via the chat agent correctly attribute actions to the initiating user.
7. **Resilience & Fault Isolation**: Verified failure of one upstream server does not degrade other upstreams.
8. **Workload Rule 5 Audit**: 100% of cluster workloads pass non-root securityContext, probes, and resource requests/limits checks.

---

## Phase 8 — Stand-Out Items & Security Hardening

### D-033: Tool Permissions per Role (Discovery Hiding & Execution Rejection)
**Context:** Certain tools possess high operational blast radiuses (e.g., creating products, modifying order statuses). Regular members should not have access to these administrative capabilities.
**Decision:** Implemented role-based tool restrictions in `src/gateway/src/auth/permissions.ts`, enforcing policies at two levels:
1. **Discovery (tools/list & GET /api/servers/tools):** Restricted tools (`woo__create_product`, `woo__update_order_status`) are filtered out of tool listings for members.
2. **Execution (tools/call & Agent loop):** If a member attempts calling a restricted tool directly via MCP or prompt manipulation, the gateway rejects the execution immediately with `isError: true` and a clear error payload: `[Gateway Forbidden] Role 'member' is not authorized to execute 'woo__create_product'. Required role: 'admin'.`
**Why:** Defense-in-depth ensures that even if a client guesses or hardcodes the tool schema, the execution is blocked server-side and recorded in the audit log.

### D-034: SSRF Protection Guard on Upstream Server Registrations
**Context:** When administrators register external or cluster-internal upstream MCP server URLs, an attacker or compromised admin account could attempt Server-Side Request Forgery (SSRF) against cloud metadata services or cluster internal APIs.
**Decision:** Implemented `validateUpstreamUrl` in `src/gateway/src/crypto/ssrf-guard.ts` applied to both `POST /api/servers` and `PUT /api/servers/:id`:
- Blocks cloud metadata addresses (`169.254.169.254`, `metadata.google.internal`, `100.100.100.200`, `instance-data`).
- Blocks loopback hosts (`127.0.0.1`, `localhost`, `0.0.0.0`, `::1`).
- Blocks the entire IPv4 link-local subnet (`169.254.0.0/16`).
- Blocks direct Kubernetes API addresses (`kubernetes`, `kubernetes.default`, `kubernetes.default.svc`).
- Strictly enforces HTTP/HTTPS schemes, blocking dangerous schemes (`gopher:`, `file:`, `ftp:`).
**Why:** Protects internal Kubernetes control planes and cloud instance credentials from unauthorized exfiltration via upstream proxy connections.

### D-035: Zero-Trust NetworkPolicies Micro-Segmentation
**Context:** In a shared Kubernetes cluster, default network policies allow all pods to communicate with all other pods. A compromised pod could attempt lateral movement into databases or upstream MCP endpoints.
**Decision:** Added Kubernetes `NetworkPolicy` objects for all platform layers in `uai/templates/network-policies.yaml`:
- `uai-postgres-netpol`: Only accepts traffic on port 5432 from pods with `app.kubernetes.io/name: gateway`.
- `uai-mariadb-netpol`: Only accepts traffic on port 3306 from pods with `app.kubernetes.io/name: woocommerce`.
- `uai-demo-mcp-netpol`: Only accepts traffic on ports 8001/8002 from pods with `app.kubernetes.io/name: gateway`.
- `uai-woo-mcp`: Only accepts traffic on port 8000 from pods with `app.kubernetes.io/name: gateway`.
**Why:** Enforces zero-trust network segregation so only authorized gateways can talk to upstreams and databases.

### D-036: Native Prometheus Metrics Observability Exporter
**Context:** Operators need visibility into tool usage, error rates, latencies, and upstream connectivity without relying on external third-party proprietary agents.
**Decision:** Implemented a lightweight Prometheus exposition metrics collector in `src/gateway/src/metrics/index.ts`, exposed at `/metrics` and `/api/metrics` via Ingress:
- `mcp_gateway_tool_calls_total{server, tool, outcome}`
- `mcp_gateway_tool_call_duration_seconds_total{server, tool, outcome}`
- `mcp_gateway_upstream_status{server, status, enabled}`
- `mcp_gateway_active_api_keys`
- `mcp_gateway_registered_users`
- `mcp_gateway_audit_records_total`
**Why:** Conforms to standard cloud-native Prometheus scraping specifications and integrates seamlessly with Grafana/Prometheus-operator.

### D-037: Parameterized Replica Scaling & Zero-Downtime Rollback Validation
**Context:** Upgrades must be testable and rollbacks must be safe without service interruption or database corruption.
**Decision:** Parameterized `replicas: {{ .Values.replicaCount | default 1 }}` in `uai/charts/gateway/templates/deployment.yaml`. Validated a live upgrade scaling the gateway to 2 replicas (Revision 11) followed by an immediate Helm rollback (Revision 12) returning to Revision 9 cleanly.
**Why:** Proves that the gateway is stateless, horizontally scalable, and resilient to deployment lifecycles.








