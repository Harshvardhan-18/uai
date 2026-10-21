# UAI MCP Gateway — Architecture & Design Document

## 1. Overview & System Architecture

UAI is a cloud-native MCP (Model Context Protocol) orchestration platform on Kubernetes that integrates WooCommerce, internal microservices, an MCP gateway, a React administration dashboard, and an autonomous chat agent.

### High-Level Topology

```
+-----------------------------------------------------------------------------------------+
|                                    KUBERNETES CLUSTER                                   |
|                                                                                         |
|  [External MCP Clients]              [Web Browser]                                      |
|  (Cursor / Claude Code)                     │                                           |
|            │                                │                                           |
|            ▼                                ▼                                           |
|  ┌─────────────────────────────────────────────────────────────┐                        |
|  │                  Ingress Controller                         │                        |
|  │       (*.localtest.me / Ingress-Nginx or Traefik)           │                        |
|  └───────────────┬──────────────────────────┬──────────────────┘                        |
|                  │                          │                                           |
|                  │ /                        │ /api/*, /mcp                              |
|                  ▼                          ▼                                           |
|      ┌─────────────────────────┐  ┌───────────────────────────────────────────┐         |
|      │   uai-dashboard (8080)  │  │            uai-gateway (3000)             │         |
|      │   React + Vite (Static) │  │  - Stateless Streamable HTTP MCP Server   │         |
|      │   Nginx Unprivileged    │  │  - Tool Aggregator & Prefix Router        │         |
|      └─────────────────────────┘  │  - AES-256-GCM Credential Manager         │         |
|                                   │  - Audit Logger & RBAC Auth Engine        │         |
|                                   │  - Autonomous Tool Loop Chat Agent        │         |
|                                   └──────────────┬────────────────────┬───────┘         |
|                                                  │                    │                 |
|                                    SQL Queries   │                    │ ClusterIP       |
|                                    (Audit/Keys)  ▼                    ▼ (Streamable     |
|                                    ┌──────────────────┐               │  HTTP / SSE)    |
|                                    │  uai-postgres-0  │               │                 |
|                                    │  (PostgreSQL 16) │               │                 |
|                                    └──────────────────┘               │                 |
|                                                                       │                 |
|                   ┌───────────────────────────────────────────────────┴──────────┐      |
|                   │                                                              │      |
|                   ▼                                                              ▼      |
|       ┌────────────────────────┐                                     ┌────────────────┐ |
|       │      uai-woo-mcp       │                                     │  uai-utils-mcp │ |
|       │      (Port 8000)       │                                     │  (Port 8001)   │ |
|       │ - NetworkPolicy: only  │                                     │  - echo        │ |
|       │   gateway pods allowed │                                     │  - time        │ |
|       └───────────┬────────────┘                                     │  - currency    │ |
|                   │ REST API v3                                      └────────────────┘ |
|                   │ Basic Auth                                                          |
|                   ▼                                                  ┌────────────────┐ |
|       ┌────────────────────────┐    Database Queries                 │ uai-everything │ |
|       │     uai-woocommerce    │───────────────────────►             │  (Port 8002)   │ |
|       │    WordPress PHP 8.2   │      ┌───────────────┐              │  - echo        │ |
|       │  Apache (Port 80, 2Gi) │      │ uai-mariadb-0 │              │  - add         │ |
|       └────────────────────────┘      │ (MariaDB 11.2)│              └────────────────┘ |
|                                       └───────────────┘                                 |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Core Components

### 2.1 Upstream MCP Servers
1. **`woo-mcp` (TypeScript, Node 20)**:
   - Exposes 5 store tools: `list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`.
   - Interacts with WooCommerce via official REST API v3 (`/wp-json/wc/v3/*`).
   - Network isolation: bound to `ClusterIP` only, guarded by a Kubernetes `NetworkPolicy` permitting ingress traffic strictly from pods labeled `app.kubernetes.io/name: gateway`.
2. **`utils-mcp` (TypeScript, Node 20)**:
   - Exposes `echo`, `get_current_time`, and `convert_currency`.
3. **`everything-mcp` (TypeScript, Node 20)**:
   - Exposes `echo`, `add`, and `get_sample_data`.
   - Exposes `echo` to verify tool collision handling alongside `utils-mcp`.

### 2.2 UAI Gateway
- **Dual MCP Role**: Exposes a stateless Streamable HTTP (SSE) MCP server to external clients and agents, while acting as an MCP client to each registered upstream.
- **Dynamic Aggregation & Namespacing**: Tools are discovered dynamically and namespaced as `<serverSlug>__<toolName>` (e.g. `utils__echo` vs `everything__echo`).
- **Resilience Architecture**:
  - `Promise.allSettled` runs upstream discovery in parallel.
  - Per-upstream timeout: 5s list, 30s tool execution.
  - In-memory tool schema caching with 60s TTL.
  - Background health checker pinging `/sse` every 30s setting statuses (`Connected`, `Unreachable`, `Disabled`).
  - Isolated failure domain: if an upstream fails, only its own tools return errors; other upstreams continue operating normally.
- **Audit Logging**:
  - Every tool invocation records user ID, email, server slug, tool name, start/end duration, outcome (`success`, `error`, `timeout`), and sanitized parameters in PostgreSQL.
  - Recursive sanitizer scrubs any field matching sensitive keys (`password`, `token`, `secret`, `key`, `authorization`, `auth`, `apiKey`).

### 2.3 Dashboard (React + Vite + Tailwind)
- Single-page application served via `nginxinc/nginx-unprivileged:alpine` on port 8080 (UID 101, non-root).
- Provides tabs for Upstream Servers, Team & Keys, Personal API Keys, Audit Logs, and AI Chat Agent.
- Zero credential leakage: API responses omit raw secrets and encrypted tokens.

### 2.4 Autonomous Chat Agent
- Backend streaming endpoint `/api/chat` over Server-Sent Events (SSE).
- Autonomous tool loop: analyzes user prompt, requests tool calls, executes them through gateway core using the authenticated user's identity, feeds results back, and streams the synthesized response.
- Pluggable LLM interface with support for Google Gemini, Groq, Ollama, and a built-in deterministic SmartIntent fallback for offline verification.

---

## 3. Tool Aggregation, Namespacing & Routing

### Collision Elimination
When multiple upstream MCP servers expose tools with the same name (such as `echo` in both `utils-mcp` and `everything-mcp`), exposing them raw causes schema ambiguity and non-deterministic routing.

Gateway sanitizes each upstream server slug to `^[a-z0-9_-]{1,32}$` and exposes tools in the format:
```
<serverSlug>__<toolName>
```
Examples:
- `utils__echo`
- `everything__echo`
- `woo__create_product`
- `woo__list_orders`

### Routing Mechanism
When an incoming JSON-RPC `tools/call` arrives:
1. Gateway extracts the tool name `name`.
2. Gateway splits `name` by `__`:
   - `serverSlug = name.split('__')[0]`
   - `toolName = name.split('__').slice(1).join('__')`
3. Gateway looks up the upstream server connection in the pool matching `serverSlug`.
4. Gateway invokes `toolName` on the upstream client with the client arguments and stored upstream credentials.

---

## 4. Failure Handling & Resilience

The gateway implements a multi-layer resilience architecture ensuring that failures in one upstream server never degrade tool discovery or call performance for other servers.

### 4.1 Parallel Discovery via `Promise.allSettled`
When discovering tools across upstreams, the gateway queries all enabled servers concurrently using `Promise.allSettled`. If any upstream times out, crashes, or is undergoing a rolling update, `Promise.allSettled` guarantees that successful responses from healthy upstreams are preserved and aggregated without throwing unhandled rejections.

### 4.2 Strict Per-Upstream Timeouts
- **Tool Listing (`upstreamTimeoutList`)**: 5,000ms. If an upstream fails to return its tool schemas within 5 seconds, discovery for that upstream is aborted with an error log, while remaining upstreams complete without delay.
- **Tool Call Execution (`upstreamTimeoutCall`)**: 30,000ms. If a long-running upstream operation exceeds 30s, the gateway aborts the call and returns a structured MCP error (`[Gateway Error] Calling <tool> timed out after 30000ms`) with `isError: true`, freeing connections and preventing cascading pool exhaustion.

### 4.3 In-Memory Schema Cache with TTL
Aggregated tool schemas are cached in an in-memory TTL cache (`toolCacheTtlMs = 30000ms`). During temporary upstream outages or pod restarts:
- Incoming `tools/list` requests are served from the warm cache in <15ms.
- External MCP clients and autonomous chat agents experience uninterrupted availability.

### 4.4 Automated Background Health Checks
A background health check loop runs periodically (`healthCheckIntervalMs = 30000ms`):
- Probes `/health` on each registered upstream with `redirect: 'error'` and connection-time SSRF validation.
- Updates Postgres columns: `health_status` (`Connected`, `Unreachable`, `Disabled`) and `health_error` (e.g. `fetch failed: connect ECONNREFUSED`).
- When a pod recovers and passes health checks, status automatically transitions back to `Connected` with `health_error` cleared.

### 4.5 Dead-Upstream Fault Isolation
- When an upstream server is dead or scaled to 0 replicas:
  - Calls to other servers (`woo__list_orders`, `everything__echo`) continue to succeed without latency degradation or error.
  - Calls targeting the dead upstream fail gracefully with an isolated error message without crashing the gateway.

---

## 5. Local vs Production Parity

The platform is designed to run identically on local development clusters (kind) and production environments (k3s VPS), differing only through Helm values (`values-local.yaml` vs `values-prod.yaml`).

| Dimension | Local (kind) | Production (k3s VPS) | Helm Value |
|---|---|---|---|
| **Ingress Controller** | Ingress-Nginx | Traefik | `ingress.className` |
| **Domain Strategy** | `*.localtest.me` (resolves to `127.0.0.1`) | Real domains or `*.nip.io` | `ingress.storeDomain`, `ingress.appDomain` |
| **Ingress Port Binding** | hostPort 80/443 mapping on kind node | LoadBalancer / HostPort on VPS | Cluster provider config |
| **Storage Class** | `standard` (kind hostpath provisioner) | `local-path` (k3s default) | Default cluster StorageClass |
| **Security Context** | Identical non-root UIDs across all pods | Identical non-root UIDs across all pods | `securityContext` templates |
| **Ingress TLS** | Plain HTTP (ingress-nginx) | Automated TLS (`spec.tls` via cert-manager) | `ingress.tls` |

> [!NOTE]
> **Production Validation Status**: Production deployment configuration (`values-prod.yaml`) is validated via `helm lint` and `helm template` only. Live cluster verification is demonstrated on local kind with 100% feature parity.
>
> **Known Security Limitation — DNS Rebinding Window**: The SSRF guard resolves hostnames asynchronously before establishing upstream connections. While loopback, cloud metadata, in-cluster private ranges, and non-allowlisted Kubernetes services are blocked, a time-of-check to time-of-use (TOCTOU) DNS rebinding window theoretically exists between resolution and socket connect if an external DNS server returns a TTL of 0. In-cluster upstreams are protected via strict `host:port` allowlisting.
