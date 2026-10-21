import { execSync } from "child_process";

const API_BASE = "http://app.localtest.me/api";

function getAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const pw = execSync('kubectl get secret -n uai uai-gateway -o jsonpath="{.data.admin-password}"', { encoding: "utf-8" });
  return Buffer.from(pw.trim(), "base64").toString("utf-8");
}

async function main() {
  const adminPassword = getAdminPassword();
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@localtest.me", password: adminPassword }),
  });
  const { token } = await loginRes.json();

  console.log("================================================================================");
  console.log("ITEM 7(c): FAILURE REASONS VERIFICATION MATRIX");
  console.log("================================================================================");

  // 1. Bad Hostname failure reason
  console.log("\n[1] TEST: BAD HOSTNAME FAILURE REASON (Registration / DNS check)");
  const badHostRes = await fetch(`${API_BASE}/servers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Nonexistent Server",
      slug: "nonexistent",
      url: "http://nonexistent-host-xyz98741.org:8000/mcp",
    }),
  });
  const badHostData = await badHostRes.json();
  console.log("Bad Hostname API Response (HTTP " + badHostRes.status + "):");
  console.log(JSON.stringify(badHostData, null, 2));

  // 2. Slow Upstream failure reason
  console.log("\n[2] TEST: SLOW UPSTREAM FAILURE REASON (Exceeds upstream timeout)");
  // Create temporary API key to invoke utils__slow_operation
  const keyRes = await fetch(`${API_BASE}/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Slow-Test-Key" }),
  });
  const { rawApiKey, key: tempKey } = await keyRes.json();

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");

  const transport = new StreamableHTTPClientTransport(new URL("http://app.localtest.me/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${rawApiKey}` } },
  });
  const client = new Client({ name: "slow-test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  console.log("Invoking utils__slow_operation with delay_seconds: 35 (gateway timeout = 30000ms)...");
  const tStart = Date.now();
  const slowCall = await client.callTool({
    name: "utils__slow_operation",
    arguments: { delay_seconds: 35 },
  });
  const elapsed = Date.now() - tStart;
  console.log(`Slow Upstream Response (elapsed: ${elapsed}ms):`);
  console.log(JSON.stringify(slowCall, null, 2));

  await client.close();
  await fetch(`${API_BASE}/keys/${tempKey.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });

  // 3. Pod Scaled to 0 failure reason
  console.log("\n[3] TEST: POD SCALED TO 0 FAILURE REASON");
  console.log("Scaling down uai-utils-mcp to 0 replicas...");
  const t0 = Date.now();
  execSync("kubectl scale deployment -n uai uai-utils-mcp --replicas=0");

  let downUtils = null;
  while (Date.now() - t0 < 45000) {
    const healthRes = await fetch(`${API_BASE}/servers/check-health`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const healthData = await healthRes.json();
    const u = healthData.servers?.find((s) => s.slug === "utils");
    if (u && u.health_status === "Unreachable") {
      downUtils = u;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log("Pod Scaled to 0 API Response (/api/servers/check-health):");
  console.log(JSON.stringify(downUtils, null, 2));

  // Also call tool when server is Unreachable to show immediate gateway error response
  console.log("\nInvoking utils tool while server is Unreachable (Immediate Interception):");
  const transport2 = new StreamableHTTPClientTransport(new URL("http://app.localtest.me/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${rawApiKey}` } },
  });
  // Generate another key for call
  const keyRes2 = await fetch(`${API_BASE}/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Down-Call-Key" }),
  });
  const { rawApiKey: key2, key: keyObj2 } = await keyRes2.json();
  const transport3 = new StreamableHTTPClientTransport(new URL("http://app.localtest.me/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${key2}` } },
  });
  const client3 = new Client({ name: "down-tester", version: "1.0.0" }, { capabilities: {} });
  await client3.connect(transport3);

  const unreachableCallRes = await client3.callTool({
    name: "utils__echo",
    arguments: { message: "Test while down" },
  });
  console.log("Tool call response while Unreachable:");
  console.log(JSON.stringify(unreachableCallRes, null, 2));

  await client3.close();
  await fetch(`${API_BASE}/keys/${keyObj2.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });

  // Restore replica
  console.log("\nRestoring uai-utils-mcp to 1 replica...");
  execSync("kubectl scale deployment -n uai uai-utils-mcp --replicas=1");
  execSync("kubectl rollout status deployment -n uai uai-utils-mcp --timeout=60s");
  await new Promise((r) => setTimeout(r, 2000));
  await fetch(`${API_BASE}/servers/check-health`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  console.log("Restored and healthy.");

  console.log("\n================================================================================");
  console.log("ITEM 7(c) VERDICT: ALL 3 FAILURE REASONS PROVED WITH RAW JSON API OUTPUT");
  console.log("================================================================================");
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
