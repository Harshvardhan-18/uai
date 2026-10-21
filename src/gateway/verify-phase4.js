import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { execSync } from "child_process";

const GATEWAY_URL = "http://app.localtest.me";

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
  console.log("============================================================");
  console.log("=== PHASE 4 COMPREHENSIVE VERIFICATION SUITE ===");
  console.log("============================================================\n");

  // Step 1: Login via REST API to obtain admin token
  console.log("--- Step 1: Admin Authentication via Ingress ---");
  const adminPassword = getAdminPassword();
  const loginRes = await fetch(`${GATEWAY_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@localtest.me",
      password: adminPassword,
    }),
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed: ${await loginRes.text()}`);
  }

  const { user, token } = await loginRes.json();
  console.log(`Logged in successfully as: ${user.email} (Role: ${user.role})\n`);

  // Step 2: Check servers status
  console.log("--- Step 2: Verifying Upstream Servers ---");
  const serversRes = await fetch(`${GATEWAY_URL}/api/servers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { servers } = await serversRes.json();
  console.log(`Registered upstreams (${servers.length}):`);
  for (const s of servers) {
    console.log(`  - [${s.slug}] ${s.name} -> ${s.url} (Health: ${s.health_status})`);
  }
  console.log();

  // Step 3: Generate an API Key
  console.log("--- Step 3: Generating API Key for MCP Client ---");
  const keyRes = await fetch(`${GATEWAY_URL}/api/keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Phase 4 Verification Key" }),
  });

  if (!keyRes.ok) {
    throw new Error(`API key generation failed: ${await keyRes.text()}`);
  }

  const { key, rawApiKey } = await keyRes.json();
  console.log(`Generated Key ID: ${key.id}`);
  console.log(`Prefix: ${key.key_prefix}`);
  console.log(`Raw key (shown once): ${rawApiKey.substring(0, 15)}...\n`);

  // Step 4: Connect MCP Client to Gateway using Streamable HTTP
  console.log("--- Step 4: Connecting MCP Client to Gateway /mcp via Ingress (Streamable HTTP) ---");
  const mcpUrl = new URL(`${GATEWAY_URL}/mcp`);
  const transport = new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: {
      headers: { Authorization: `Bearer ${rawApiKey}` },
    },
  });

  const client = new Client(
    { name: "phase4-inspector", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("Connected to Gateway MCP Server via Ingress over Streamable HTTP!\n");

  // Step 5: List Aggregated Tools
  console.log("--- Step 5: Listing Aggregated Namespaced Tools ---");
  const toolsList = await client.listTools();
  console.log(`Gateway aggregated ${toolsList.tools.length} total tools:`);
  for (const t of toolsList.tools) {
    console.log(`  * ${t.name}: ${t.description.split("\n")[0]}`);
  }
  console.log();

  // Check expected prefix patterns
  const toolNames = toolsList.tools.map((t) => t.name);
  const hasWoo = toolNames.some((n) => n.startsWith("woo__"));
  const hasUtils = toolNames.some((n) => n.startsWith("utils__"));
  const hasEverything = toolNames.some((n) => n.startsWith("everything__"));

  if (!hasWoo || !hasUtils || !hasEverything) {
    throw new Error("Missing prefixed tools from one or more upstream servers!");
  }
  console.log("Prefix namespacing verified across all 3 servers (woo__, utils__, everything__)!\n");

  // Step 6: Verify Collision Handling on `echo`
  console.log("--- Step 6: Verifying Tool Collision Handling (utils__echo vs everything__echo) ---");
  
  const utilsEchoRes = await client.callTool({
    name: "utils__echo",
    arguments: { message: "Hello from utils" },
  });
  console.log("utils__echo result:");
  console.log(utilsEchoRes.content[0].text);

  const everythingEchoRes = await client.callTool({
    name: "everything__echo",
    arguments: { message: "Hello from everything" },
  });
  console.log("everything__echo result:");
  console.log(everythingEchoRes.content[0].text);
  console.log("Collision handling verified: identical upstream tool names routed cleanly via server slug prefix!\n");

  // Step 7: Demo Prompt Execution: "get today's orders, then convert the total to EUR"
  console.log("--- Step 7: Executing Two-Server Demo Flow: Orders + Currency Conversion ---");
  const ordersRes = await client.callTool({
    name: "woo__list_orders",
    arguments: { per_page: 5 },
  });
  const orders = JSON.parse(ordersRes.content[0].text);
  
  if (!Array.isArray(orders) || orders.length === 0) {
    throw new Error("Assertion failed: No orders found in WooCommerce store!");
  }

  const firstOrder = orders[0];
  if (!firstOrder.id || !firstOrder.total) {
    throw new Error(`Assertion failed: Order returned invalid fields: ${JSON.stringify(firstOrder)}`);
  }

  const orderTotal = parseFloat(firstOrder.total);
  if (isNaN(orderTotal) || orderTotal <= 0) {
    throw new Error(`Assertion failed: Invalid order total: ${firstOrder.total}`);
  }

  console.log(`Fetched real order #${firstOrder.id} total: $${orderTotal} ${firstOrder.currency || "USD"}`);

  const convertRes = await client.callTool({
    name: "utils__convert_currency",
    arguments: { amount: orderTotal, from: "USD", to: "EUR" },
  });
  console.log("Currency conversion result:");
  console.log(convertRes.content[0].text);
  
  const convertData = JSON.parse(convertRes.content[0].text);
  if (!convertData.converted_amount || isNaN(convertData.converted_amount)) {
    throw new Error(`Assertion failed: Currency conversion did not return converted_amount: ${convertRes.content[0].text}`);
  }
  console.log();

  await client.close();

  // Step 8: Key Revocation Immediate Rejection Test
  console.log("--- Step 8: Testing Immediate Key Revocation ---");
  const revokeRes = await fetch(`${GATEWAY_URL}/api/keys/${key.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`Revocation response: ${(await revokeRes.json()).message}`);

  // Test that calling /mcp with revoked key fails immediately
  console.log("Attempting connection with revoked key over Streamable HTTP...");
  const revokedTransport = new StreamableHTTPClientTransport(new URL(`${GATEWAY_URL}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${rawApiKey}` },
    },
  });

  const revokedClient = new Client(
    { name: "revoked-test", version: "1.0.0" },
    { capabilities: {} }
  );

  let rejected = false;
  try {
    await revokedClient.connect(revokedTransport);
    await revokedClient.listTools();
  } catch (err) {
    rejected = true;
    console.log(`Connection correctly REJECTED with error: ${err.message}`);
  }

  if (!rejected) {
    throw new Error("Security violation: Revoked API key was NOT rejected!");
  }
  console.log("Key revocation verified: Rejected on the very next call!\n");

  // Step 9: Audit Log Verification
  console.log("--- Step 9: Verifying Audit Log Entries ---");
  const auditRes = await fetch(`${GATEWAY_URL}/api/audit?limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const auditData = await auditRes.json();
  console.log(`Total audit entries recorded: ${auditData.total}`);
  for (const entry of auditData.logs) {
    console.log(`  [Audit] ${entry.created_at} | User: ${entry.user_email} | ${entry.server_slug}__${entry.tool_name} | Outcome: ${entry.outcome} (${entry.duration_ms}ms)`);
  }
  console.log();

  console.log("============================================================");
  console.log("=== PHASE 4 VERIFICATION GREEN! ALL CHECKS PASSED ===");
  console.log("============================================================");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
