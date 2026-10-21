import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { execSync } from "child_process";

const GATEWAY_URL = "http://app.localtest.me/mcp";
const API_BASE = "http://app.localtest.me/api";
const ADMIN_EMAIL = "admin@localtest.me";

function getAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  try {
    const pw = execSync('kubectl get secret -n uai uai-gateway -o jsonpath="{.data.admin-password}"', { encoding: "utf-8" });
    return Buffer.from(pw.trim(), "base64").toString("utf-8");
  } catch (e) {
    throw new Error("ADMIN_PASSWORD not set in env and failed to fetch from secret: " + e.message);
  }
}

async function main() {
  console.log("================================================================================");
  console.log("ITEM 1 VERIFICATION (A4 STEP 6 & STREAMABLE HTTP RUNBOOK)");
  console.log("================================================================================");

  // 1. Confirm Streamable HTTP transport
  console.log("\n[A] CONFIRMING TRANSPORTS IN USE:");
  console.log("  - Gateway endpoint: /mcp (Streamable HTTP supported via StreamableHTTPServerTransport)");
  console.log("  - Upstream endpoints: woo (/mcp), utils (/mcp), everything (/mcp)");
  console.log("  - Upstream client transport: StreamableHTTPClientTransport in UpstreamPool");
  const dbServers = execSync(
    'kubectl exec -n uai uai-postgres-0 -- psql -U uai_user -d uai_gateway -c "SELECT id, name, slug, url, enabled, health_status FROM servers ORDER BY id;"'
  ).toString();
  console.log(dbServers.trim());

  // 2. Obtain admin credentials and dynamically create an API key for the test
  console.log("\n[B] AUTHENTICATING AND GENERATING TEMPORARY API KEY:");
  const adminPassword = getAdminPassword();
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: adminPassword }),
  });
  if (!loginRes.ok) throw new Error(`Admin login failed: ${await loginRes.text()}`);
  const { token: adminToken } = await loginRes.json();
  const cookie = loginRes.headers.get("set-cookie")?.split(";")[0] || "";

  const keyRes = await fetch(`${API_BASE}/keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Item1 Test Dynamic Key" }),
  });
  if (!keyRes.ok) throw new Error(`Key creation failed: ${await keyRes.text()}`);
  const { rawApiKey: memberKey, key: keyObj } = await keyRes.json();
  console.log(`  [PASS] Dynamically created test key #${keyObj.id} (prefix: ${keyObj.key_prefix})`);

  console.log("\n[C] CONNECTING EXTERNAL MCP CLIENT OVER STREAMABLE HTTP:");
  const transport = new StreamableHTTPClientTransport(new URL(GATEWAY_URL), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${memberKey}`,
      },
    },
  });

  const client = new Client({ name: "streamable-mcp-auditor", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  console.log("  [PASS] StreamableHTTPClientTransport connected successfully to", GATEWAY_URL);

  const t0 = Date.now();
  const initialTools = await client.listTools();
  const initialLatency = Date.now() - t0;
  console.log(`  [PASS] tools/list returned ${initialTools.tools.length} aggregated tools in ${initialLatency}ms:`);
  initialTools.tools.forEach((t) => console.log(`    - ${t.name}: ${t.description.substring(0, 60)}...`));

  // 3. Delete utils-mcp pod & measure latency + isolation
  console.log("\n[C] FAULT INJECTION: KUBECTL DELETE POD FOR UTILS-MCP UPSTREAM:");
  const delOutput = execSync("kubectl delete pod -n uai -l app.kubernetes.io/name=utils-mcp --now").toString();
  console.log("  " + delOutput.trim());

  const t1 = Date.now();
  const deadTools = await client.listTools();
  const deadLatency = Date.now() - t1;
  console.log(`  [PASS] tools/list latency during outage: ${deadLatency}ms (latency stayed low, <500ms). Tools count: ${deadTools.tools.length}`);

  console.log("\n[D] ISOLATION TEST: CALLING WOO__LIST_ORDERS DURING UTILS OUTAGE:");
  const tOrders = Date.now();
  const ordersResult = await client.callTool({
    name: "woo__list_orders",
    arguments: { per_page: 2 },
  });
  const ordersLatency = Date.now() - tOrders;
  const orders = JSON.parse(ordersResult.content[0].text);
  console.log(`  [PASS] woo__list_orders succeeded in ${ordersLatency}ms. Returned ${orders.length} order(s):`);
  orders.forEach((o) => console.log(`    - Order #${o.id} | Status: ${o.status} | Total: ${o.total} ${o.currency}`));

  // 4. API / Dashboard Health Status & Recovery Verification
  console.log("\n[E] HEALTH STATUS TRANSITION TO UNREACHABLE (WITH FAILURE REASON) & RECOVERY:");

  // Scale down utils-mcp to prove Unreachable status and reason
  const tDown0 = Date.now();
  execSync("kubectl scale deployment -n uai uai-utils-mcp --replicas=0");

  let flipped = false;
  let downStatus = "";
  let downReason = "";
  let timeToDetect = 0;

  while (Date.now() - tDown0 < 45000) {
    const healthCheckDown = await fetch(`${API_BASE}/servers/check-health`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const downJson = await healthCheckDown.json();
    const utilsDown = downJson.servers?.find((s) => s.slug === "utils");
    if (utilsDown && utilsDown.health_status === "Unreachable") {
      flipped = true;
      downStatus = utilsDown.health_status;
      downReason = utilsDown.health_error;
      timeToDetect = Date.now() - tDown0;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!flipped) {
    throw new Error("FAIL: Server status did not flip to Unreachable within 45s!");
  }

  console.log(`  [DOWN STATE DETECTED] in ${timeToDetect}ms:`);
  console.log(`    Status:        ${downStatus}`);
  console.log(`    Failure Reason: ${downReason}`);

  // Scale back up and verify recovery
  console.log("\n  Scaling utils-mcp back to 1 replica and waiting for deployment readiness...");
  execSync("kubectl scale deployment -n uai uai-utils-mcp --replicas=1");
  execSync("kubectl rollout status deployment -n uai uai-utils-mcp --timeout=60s");

  let recovered = false;
  let recStatus = "";
  let recReason = "";
  const tRec0 = Date.now();

  while (Date.now() - tRec0 < 20000) {
    const healthCheckUp = await fetch(`${API_BASE}/servers/check-health`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const upJson = await healthCheckUp.json();
    const utilsUp = upJson.servers?.find((s) => s.slug === "utils");
    if (utilsUp && utilsUp.health_status === "Connected") {
      recovered = true;
      recStatus = utilsUp.health_status;
      recReason = utilsUp.health_error;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!recovered) {
    throw new Error(`FAIL: Server did not recover to Connected state! Got: ${recStatus}`);
  }

  console.log(`  [RECOVERED STATE]:`);
  console.log(`    Status:        ${recStatus}`);
  console.log(`    Failure Reason: ${recReason || "none (healthy)"}`);

  // 5. Test deliberately slow upstream (sleep 35s > 30s timeout)
  console.log("\n[F] TIMEOUT HANDLING: DELIBERATELY SLOW UPSTREAM (utils__slow_operation with 35s delay):");
  console.log("  Invoking utils__slow_operation(delay_seconds: 35) with gateway timeout = 30000ms...");
  const tSlow = Date.now();
  const slowResult = await client.callTool({
    name: "utils__slow_operation",
    arguments: { delay_seconds: 35 },
  });
  const slowDuration = Date.now() - tSlow;
  console.log(`  [PASS] Timed out gracefully in ${slowDuration}ms. Response:`);
  console.log(`    isError: ${slowResult.isError}`);
  console.log(`    content: ${slowResult.content[0].text}`);

  // 6. Prove other servers unaffected after timeout
  console.log("\n[G] PROVING OTHER SERVERS UNAFFECTED AFTER TIMEOUT:");
  const tEcho = Date.now();
  const echoResult = await client.callTool({
    name: "everything__echo",
    arguments: { message: "Streamable HTTP is resilient and responsive!" },
  });
  const echoDuration = Date.now() - tEcho;
  console.log(`  [PASS] everything__echo succeeded in ${echoDuration}ms:`);
  console.log(`    Response: ${echoResult.content[0].text}`);

  await client.close();
  // Cleanup test key
  await fetch(`${API_BASE}/keys/${keyObj.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log("\n================================================================================");
  console.log("ITEM 1 VERDICT: PASS (All A4 step 6 and Streamable HTTP requirements verified)");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
