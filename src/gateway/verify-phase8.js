import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { execSync } from "child_process";

const BASE_URL = "http://app.localtest.me";

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${email}: ${await res.text()}`);
  }
  return res.json();
}

async function createApiKey(token, name) {
  const res = await fetch(`${BASE_URL}/api/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Create API key failed: ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log("======================================================================");
  console.log("=== PHASE 8: STAND-OUT ITEMS VERIFICATION & SECURITY HARDENING AUDIT ===");
  console.log("======================================================================\n");

  const { user: adminUser, token: adminToken } = await login("admin@localtest.me", "REDACTED_ADMIN_PASS");
  const { user: memberUser, token: memberToken } = await login("member@localtest.me", "REDACTED_MEMBER_PASS");

  // ──────────────────────────────────────────────────────────────────
  // Check 1: Tool Permissions Per Role (Hidden from list & rejected on call)
  // ──────────────────────────────────────────────────────────────────
  console.log("--- Check 1: Tool Permissions per Role (RBAC) ---");

  // 1a. REST API tools listing
  const adminToolsRes = await fetch(`${BASE_URL}/api/servers/tools`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const { tools: adminTools } = await adminToolsRes.json();
  const adminHasCreateProd = adminTools.some((t) => t.name === "woo__create_product");
  const adminHasUpdateOrder = adminTools.some((t) => t.name === "woo__update_order_status");
  console.log(`Admin sees ${adminTools.length} tools. Can see woo__create_product: ${adminHasCreateProd}, woo__update_order_status: ${adminHasUpdateOrder}`);
  if (!adminHasCreateProd || !adminHasUpdateOrder) {
    throw new Error("Admin should be able to see all tools!");
  }

  const memberToolsRes = await fetch(`${BASE_URL}/api/servers/tools`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  const { tools: memberTools } = await memberToolsRes.json();
  const memberHasCreateProd = memberTools.some((t) => t.name === "woo__create_product");
  const memberHasUpdateOrder = memberTools.some((t) => t.name === "woo__update_order_status");
  console.log(`Member sees ${memberTools.length} tools. Can see woo__create_product: ${memberHasCreateProd}, woo__update_order_status: ${memberHasUpdateOrder}`);
  if (memberHasCreateProd || memberHasUpdateOrder) {
    throw new Error("Security Violation: Member was able to discover admin-restricted tools in REST API!");
  }
  console.log("  [REST API] Admin-restricted tools strictly hidden from Member tools list (PASS)");

  // 1b. MCP Streamable HTTP tools/list & tools/call
  const { rawApiKey: memberApiKey } = await createApiKey(memberToken, "Phase8-Member-Key");
  const { rawApiKey: adminApiKey } = await createApiKey(adminToken, "Phase8-Admin-Key");

  // Connect Member MCP client
  const memberTransport = new SSEClientTransport(new URL(`${BASE_URL}/mcp`), {
    eventSourceInit: { headers: { Authorization: `Bearer ${memberApiKey}` } },
    requestInit: { headers: { Authorization: `Bearer ${memberApiKey}` } },
  });
  const memberMcpClient = new Client({ name: "phase8-member", version: "1.0.0" }, { capabilities: {} });
  await memberMcpClient.connect(memberTransport);

  const memberMcpTools = await memberMcpClient.listTools();
  const mcpMemberHasCreate = memberMcpTools.tools.some((t) => t.name === "woo__create_product");
  console.log(`Member MCP client sees ${memberMcpTools.tools.length} tools. Has woo__create_product: ${mcpMemberHasCreate}`);
  if (mcpMemberHasCreate) {
    throw new Error("Security Violation: Member MCP client saw woo__create_product in tools/list!");
  }
  console.log("  [MCP Protocol] Admin-restricted tools hidden from tools/list for Member (PASS)");

  // Attempt to call woo__create_product as Member
  console.log("Attempting to invoke woo__create_product as Member...");
  const memberForbiddenCall = await memberMcpClient.callTool({
    name: "woo__create_product",
    arguments: { name: "Illegal Hack Product", regular_price: "999" },
  });

  console.log("Member tool call response:", memberForbiddenCall);
  if (!memberForbiddenCall.isError) {
    throw new Error("Security Violation: Member call to woo__create_product was not flagged as isError: true!");
  }
  const errorText = memberForbiddenCall.content[0]?.text || "";
  if (!errorText.includes("[Gateway Forbidden]")) {
    throw new Error(`Expected [Gateway Forbidden] error message, got: ${errorText}`);
  }
  console.log(`  [MCP Enforcement] Call rejected immediately: "${errorText}" (PASS)`);

  // Member calls allowed tool
  const memberAllowedCall = await memberMcpClient.callTool({
    name: "utils__get_current_time",
    arguments: { timezone: "UTC" },
  });
  if (memberAllowedCall.isError) {
    throw new Error("Member was unexpectedly blocked from calling allowed tool utils__get_current_time");
  }
  console.log("  [MCP Enforcement] Allowed tool call executed successfully (PASS)");

  await memberMcpClient.close();
  console.log("PASSED: Role-based tool permissions (hidden + rejected) verified.\n");

  // ──────────────────────────────────────────────────────────────────
  // Check 2: SSRF Guard on Admin Server URLs
  // ──────────────────────────────────────────────────────────────────
  console.log("--- Check 2: SSRF Protection on Admin Upstream Registrations ---");

  const maliciousUrls = [
    { label: "AWS EC2 Metadata Service", url: "http://169.254.169.254/latest/meta-data" },
    { label: "GCP Metadata Service", url: "http://metadata.google.internal/computeMetadata/v1" },
    { label: "Alibaba Cloud Metadata", url: "http://100.100.100.200/latest/meta-data" },
    { label: "Loopback IPv4 (127.0.0.1)", url: "http://127.0.0.1:8080/secret" },
    { label: "Loopback Hostname (localhost)", url: "http://localhost:3000/internal" },
    { label: "Link-Local Subnet (169.254.42.1)", url: "http://169.254.42.1:80" },
    { label: "Kubernetes Control Plane", url: "http://kubernetes.default.svc/api/v1" },
    { label: "Dangerous Scheme (gopher)", url: "gopher://10.0.0.1:70" },
    { label: "Dangerous Scheme (file)", url: "file:///etc/passwd" },
  ];

  for (const test of maliciousUrls) {
    const res = await fetch(`${BASE_URL}/api/servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `SSRF Test - ${test.label}`,
        slug: `ssrf-test-${Math.random().toString(36).slice(2, 6)}`,
        url: test.url,
      }),
    });

    if (res.status !== 400) {
      throw new Error(`SSRF Bypass detected! URL "${test.url}" was not rejected with HTTP 400! (Status: ${res.status})`);
    }
    const errBody = await res.json();
    console.log(`  [SSRF Guard] Blocked "${test.label}": ${errBody.error}`);
  }
  console.log("PASSED: SSRF Guard effectively blocked 100% of tested malicious destinations.\n");

  // ──────────────────────────────────────────────────────────────────
  // Check 3: Observability & Prometheus Metrics
  // ──────────────────────────────────────────────────────────────────
  console.log("--- Check 3: Observability & Prometheus Metrics ---");
  const metricsRes = await fetch(`${BASE_URL}/metrics`);
  if (!metricsRes.ok) {
    throw new Error(`Failed to fetch /metrics: HTTP ${metricsRes.status}`);
  }
  const metricsText = await metricsRes.text();

  console.log("Prometheus Metrics Sample Output:");
  const metricLines = metricsText.split("\n").filter((l) => l && !l.startsWith("#"));
  metricLines.slice(0, 10).forEach((l) => console.log(`  ${l}`));

  if (!metricsText.includes("mcp_gateway_tool_calls_total")) {
    throw new Error("Missing metric: mcp_gateway_tool_calls_total");
  }
  if (!metricsText.includes('mcp_gateway_upstream_status{server="woo"')) {
    throw new Error("Missing metric: mcp_gateway_upstream_status for woo");
  }
  if (!metricsText.includes('mcp_gateway_upstream_status{server="utils"')) {
    throw new Error("Missing metric: mcp_gateway_upstream_status for utils");
  }
  if (!metricsText.includes('mcp_gateway_upstream_status{server="everything"')) {
    throw new Error("Missing metric: mcp_gateway_upstream_status for everything");
  }
  console.log("PASSED: Prometheus metrics endpoint verified with per-server health status and counters.\n");

  // ──────────────────────────────────────────────────────────────────
  // Check 4: NetworkPolicies Micro-Segmentation
  // ──────────────────────────────────────────────────────────────────
  console.log("--- Check 4: NetworkPolicies Verification ---");
  const netpolOutput = execSync("kubectl -n uai get networkpolicies -o jsonpath=\"{.items[*].metadata.name}\"", { encoding: "utf-8" });
  console.log(`Active NetworkPolicies in uai namespace: ${netpolOutput}`);
  const requiredPolicies = ["uai-postgres-netpol", "uai-mariadb-netpol", "uai-demo-mcp-netpol", "uai-woo-mcp"];
  for (const pol of requiredPolicies) {
    if (!netpolOutput.includes(pol)) {
      throw new Error(`Missing required NetworkPolicy: ${pol}`);
    }
  }
  console.log("PASSED: All 4 zero-trust micro-segmentation NetworkPolicies active.\n");

  console.log("======================================================================");
  console.log("=== ALL PHASE 8 STAND-OUT VERIFICATIONS PASSED SUCCESSFULLY ===");
  console.log("======================================================================");
}

main().catch((err) => {
  console.error("\n❌ Phase 8 Verification FAILED:", err);
  process.exit(1);
});
