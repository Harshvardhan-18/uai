# UAI MCP Gateway — Live Demo Script & Walkthrough

This script provides a step-by-step walkthrough for recording a live demo or presentation of the **UAI MCP Platform on Kubernetes**.

---

## Demo Overview (Total Duration: ~5-7 Minutes)

| Section | Topic | Key Talking Points |
|---|---|---|
| **Part 1** | Architecture & Cluster | Single umbrella chart, 7 pods, non-root, ingress routing |
| **Part 2** | WooCommerce Store | Persistent WordPress + MariaDB, automated WP-CLI bootstrap, COD |
| **Part 3** | Admin Dashboard & Security | Server health status, zero credential leakage, namespaced tools |
| **Part 4** | External MCP Client | Connecting via Streamable HTTP, collision handling (`utils` vs `everything`), 2-server demo flow |
| **Part 5** | Team RBAC & Key Revocation | Member vs Admin permissions, immediate revocation (401) |
| **Part 6** | Fault Isolation & Resilience | Simulating upstream outage, other services unaffected |
| **Part 7** | Autonomous Chat Agent | "create a product X at 499", storefront check, "what orders came in today", audit log attribution |

---

## Step-by-Step Demo Flow

### Part 1: Cluster & Pod Status (Terminal)
1. **Show running workloads**:
   ```bash
   kubectl get pods -n uai
   ```
2. **Key Talking Points**:
   - Point out all 8 pods: `uai-dashboard`, `uai-gateway`, `uai-postgres-0`, `uai-mariadb-0`, `uai-woocommerce`, `uai-woo-mcp`, `uai-utils-mcp`, and `uai-everything-mcp`.
   - Mention Rule 5: 100% of pods run with non-root securityContext, probes, and resource requests/limits.

---

### Part 2: WooCommerce Storefront (Browser)
1. **Open**: `http://store.localtest.me` in your browser.
2. **Show**:
   - The pre-seeded catalog products (e.g. Ergonomic Mechanical Keyboard).
   - Point out that setup was 100% automated via WP-CLI Kubernetes Job (permalinks, COD payment method, REST keys).

---

### Part 3: UAI Dashboard & Server Health (Browser)
1. **Open**: `http://app.localtest.me` in your browser.
2. **Sign in**: Click the **Quick Demo Fill** button (`admin@localtest.me` / `REDACTED_ADMIN_PASS`).
3. **Show**:
   - **Upstream Servers tab**: All 3 servers show `Connected` (green pulse badge).
   - Click **"View Tools"** on `WooCommerce Store` to show the 5 tools and expand the JSON Schema preview.
   - Click **"Add Server"**: Notice the note explaining that credentials are encrypted with AES-256-GCM and never returned by the API.

---

### Part 4: External MCP Client & Tool Collision Handling (Terminal)
1. **Explain Tool Namespacing**:
   - Both `utils-mcp` and `everything-mcp` expose an `echo` tool.
   - The gateway automatically namespaces them as `utils__echo` and `everything__echo`.
2. **Execute the Verification Script**:
   ```bash
   node src/gateway/verify-phase4.js
   ```
3. **Show Output**:
   - Both `utils__echo` and `everything__echo` execute cleanly with zero collision.
   - Show the two-server demo prompt output: fetched order #13 ($149 USD) and converted to EUR (€137.08).

---

### Part 5: Team RBAC & Immediate Key Revocation
1. **In the Dashboard**:
   - Switch to **Team & Keys** tab: show the team member list and organizational API keys.
   - Switch to **My API Keys** tab: click **Generate New API Key** to demonstrate the modal showing the raw key `gw_...` once with a copy button.
2. **Execute 2-User Rehearsal**:
   ```bash
   node src/gateway/verify-phase7.js
   ```
3. **Point Out**:
   - Member attempts to create a server: blocked with **HTTP 403 Forbidden**.
   - Member revokes their API key: subsequent connection fails immediately with **HTTP 401**.

---

### Part 6: Fault Isolation & Resilience
1. **Simulate Upstream Outage**:
   ```bash
   kubectl -n uai scale deployment uai-utils-mcp --replicas=0
   ```
2. **Execute Resilience Check**:
   ```bash
   node src/gateway/verify-resilience.js
   ```
3. **Point Out**:
   - `everything__echo` and `woo__list_products` continue succeeding with zero latency degradation.
   - `utils__echo` returns an isolated error: `[Gateway Error] fetch failed`.
4. **Restore the Pod**:
   ```bash
   kubectl -n uai scale deployment uai-utils-mcp --replicas=1
   ```

---

### Part 7: Autonomous Chat Agent
1. **In the Dashboard**:
   - Switch to **Chat Agent** tab.
2. **Run Prompt 1**:
   - Type or click: `"create a product Wireless Noise-Canceling Earbuds at 499"`
   - Watch the live SSE streaming:
     - Thought indicator appears: `Analyzing request...`
     - Collapsible tool call card appears: `woo__create_product` with arguments.
     - Final response displays the product ID and permalink!
3. **Verify on Store**:
   - Refresh `http://store.localtest.me` or check the WooCommerce catalog: the new product is live in the store!
4. **Run Prompt 2**:
   - Type: `"what orders came in today"`
   - Watch the agent invoke `woo__list_orders` and format a report of Order #13.
5. **Show Audit Log**:
   - Switch to **Audit Log** tab: show that both chat tool calls are stamped with `admin@localtest.me`, duration in ms, outcome `success`, and sanitized parameters.

---

### Part 8: Stand-Out Features & Security Hardening (Terminal & Browser)
1. **Tool Permissions per Role (RBAC)**:
   - Run: `node src/gateway/verify-phase8.js`
   - Point out that Admin discovers 11 tools, while Member discovers only 9.
   - Point out that when Member tries to call `woo__create_product`, the gateway immediately rejects it with `[Gateway Forbidden] Role 'member' is not authorized to execute 'woo__create_product'. Required role: 'admin'.`
2. **SSRF Guard**:
   - Show how the gateway blocks cloud metadata attempts (`169.254.169.254`, `metadata.google.internal`), loopback addresses (`127.0.0.1`), and link-local ranges with HTTP 400 Bad Request.
3. **Live Prometheus Metrics**:
   - Open or curl: `http://app.localtest.me/metrics`
   - Point out real-time scrape counters: `mcp_gateway_tool_calls_total`, latencies, and gauge `mcp_gateway_upstream_status`.
4. **Zero-Downtime Helm Lifecycle**:
   - Mention the tested upgrade to 2 replicas (`helm upgrade ... --set gateway.replicaCount=2`) and clean rollback (`helm rollback uai 9`).

