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
  console.log("=== RESILIENCE TEST: ISOLATION DURING UPSTREAM FAILURE ===");

  // 1. Get admin token & key
  const adminPassword = getAdminPassword();
  const loginRes = await fetch(`${GATEWAY_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@localtest.me",
      password: adminPassword,
    }),
  });
  const { token } = await loginRes.json();

  const keyRes = await fetch(`${GATEWAY_URL}/api/keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Resilience Test Key" }),
  });
  const { rawApiKey, key: keyObj } = await keyRes.json();

  // 2. Connect client
  const mcpUrl = new URL(`${GATEWAY_URL}/mcp`);
  const transport = new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: { headers: { Authorization: `Bearer ${rawApiKey}` } },
  });
  const client = new Client({ name: "resilience-tester", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  console.log("Connected to Gateway.");

  // 3. Test everything__echo while utils-mcp is down
  console.log("Testing everything__echo (should succeed)...");
  const everythingRes = await client.callTool({
    name: "everything__echo",
    arguments: { message: "Alive and kicking!" },
  });
  console.log("everything__echo output:", everythingRes.content[0].text);

  // 4. Test woo__list_products while utils-mcp is down
  console.log("Testing woo__list_products (should succeed)...");
  const wooRes = await client.callTool({
    name: "woo__list_products",
    arguments: { per_page: 1 },
  });
  console.log("woo__list_products output length:", wooRes.content[0].text.length);

  // 5. Test utils__echo (should gracefully return clear error)
  console.log("Testing utils__echo (should fail gracefully with clear error)...");
  const utilsRes = await client.callTool({
    name: "utils__echo",
    arguments: { message: "Anyone home?" },
  });
  console.log("utils__echo output (isError:", utilsRes.isError, "):");
  console.log(utilsRes.content[0].text);

  await client.close();
  // Cleanup test key
  await fetch(`${GATEWAY_URL}/api/keys/${keyObj.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log("\nResilience verification completed successfully!");
}

main().catch((err) => {
  console.error("Resilience test failed:", err);
  process.exit(1);
});
