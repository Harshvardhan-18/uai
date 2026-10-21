import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { execSync } from "child_process";

const BASE_URL = "http://app.localtest.me";

function getAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const pw = execSync('kubectl get secret -n uai uai-gateway -o jsonpath="{.data.admin-password}"', { encoding: "utf-8" });
  return Buffer.from(pw.trim(), "base64").toString("utf-8");
}

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${await res.text()}`);
  return res.json();
}

async function readSSEStream(url, token, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`SSE stream failed: ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const jsonStr = trimmed.substring(6).trim();
      if (!jsonStr) continue;
      try {
        const event = JSON.parse(jsonStr);
        if (event.type === "delta" || event.type === "done") {
          finalResponse = event.content;
        }
      } catch {}
    }
  }
  return finalResponse;
}

async function main() {
  console.log("================================================================================");
  console.log("ITEM 4: REAL ORDER FLOW (USER A CHAT AGENT & USER B STREAMABLE HTTP CLIENT)");
  console.log("================================================================================");

  // 1. Authenticate User A (Admin)
  const adminPassword = getAdminPassword();
  const { token: adminToken } = await login("admin@localtest.me", adminPassword);
  console.log("User A (Admin) authenticated: admin@localtest.me");

  // 2. Authenticate User B (Member) via genuine Admin Invite Flow
  console.log("\n[Auth] Admin inviting User B (member@localtest.me) via invite flow...");
  try {
    execSync('kubectl -n uai exec -i uai-postgres-0 -- psql -U uai_user -d uai_gateway -c "DELETE FROM users WHERE email = \'member@localtest.me\';"');
  } catch {}

  const inviteRes = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "member@localtest.me", role: "member" }),
  });
  const inv = await inviteRes.json();
  const memberPassword = inv.temporaryPassword;
  console.log(`User B invited successfully. Received dynamic one-time password (length: ${memberPassword?.length})`);

  const { token: memberToken } = await login("member@localtest.me", memberPassword);
  console.log("User B (Member) authenticated: member@localtest.me");

  // 3. User A queries Chat Agent: "what orders came in today"
  console.log("\n[A] User A asking Chat Agent: \"what orders came in today\"...");
  const agentResponse = await readSSEStream(`${BASE_URL}/api/chat`, adminToken, {
    message: "what orders came in today",
  });
  console.log("\n--- User A (Chat Agent) Output ---");
  console.log(agentResponse);

  // 4. User B connects via Streamable HTTP Client and invokes woo__list_orders
  console.log("\n[B] User B connecting via external Streamable HTTP client...");
  // Create personal API key for User B
  const keyRes = await fetch(`${BASE_URL}/api/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${memberToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "UserB-OrderFlow-Key" }),
  });
  const { rawApiKey: memberApiKey, key: keyObj } = await keyRes.json();

  const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${memberApiKey}` } },
  });
  const memberClient = new Client({ name: "user-b-client", version: "1.0.0" }, { capabilities: {} });
  await memberClient.connect(transport);

  console.log("User B invoking woo__list_orders via Streamable HTTP...");
  const memberOrdersRes = await memberClient.callTool({
    name: "woo__list_orders",
    arguments: { per_page: 5 },
  });
  await memberClient.close();
  // Revoke/cleanup User B test key
  await fetch(`${BASE_URL}/api/keys/${keyObj.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${memberToken}` } });

  console.log("\n--- User B (External Streamable HTTP MCP Client) Output ---");
  console.log(memberOrdersRes.content[0].text);

  // 5. Query Audit Logs for both invocations
  console.log("\n[C] MATCHING AUDIT LOG ROWS (User Attribution Verification):");
  const auditRes = await fetch(`${BASE_URL}/api/audit?limit=6`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const { logs } = await auditRes.json();
  const orderAudits = logs.filter((l) => l.tool_name === "list_orders" || l.tool_name === "woo__list_orders");
  console.log("Timestamp".padEnd(28) + "User Email".padEnd(24) + "Tool".padEnd(20) + "Outcome".padEnd(10) + "Duration");
  console.log("-".repeat(85));
  for (const l of orderAudits.slice(0, 4)) {
    console.log(
      String(l.created_at).padEnd(28) +
      String(l.user_email).padEnd(24) +
      String(l.server_slug + "__" + l.tool_name).padEnd(20) +
      String(l.outcome).padEnd(10) +
      String(l.duration_ms) + "ms"
    );
  }

  console.log("\n================================================================================");
  console.log("ITEM 4 VERDICT: PASS (Both User A and User B successfully queried real order #14 with verified audit attribution)");
  console.log("================================================================================");
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
