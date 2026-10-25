import { execSync } from "child_process";

const BASE_URL = "http://app.localtest.me";

function getPassword() {
  const pw = execSync('kubectl get secret -n uai uai-gateway -o jsonpath="{.data.admin-password}"', { encoding: "utf-8" });
  return Buffer.from(pw.trim(), "base64").toString("utf-8");
}

async function loginMember() {
  const password = getPassword();
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "member@localtest.me", password }),
  });
  if (!res.ok) throw new Error(`Member login failed: ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log("=== ITEM 10(a): SECURITY DEMO - RBAC ENFORCEMENT FOR MEMBER ===");
  const { token, user } = await loginMember();
  console.log(`Logged in as: ${user.email} (Role: ${user.role})`);

  console.log("\nAsking agent as Member: 'create a product Luxury Watch at 499' ...");
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: "create a product Luxury Watch at 499" }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalContent = "";
  let meta = null;
  let toolCalled = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() || "";
    for (const l of lines) {
      if (!l.startsWith("data: ")) continue;
      try {
        const ev = JSON.parse(l.substring(6));
        if (ev.type === "meta") meta = ev;
        if (ev.type === "tool_call_start") toolCalled = ev;
        if (ev.type === "done") finalContent = ev.content;
      } catch {}
    }
  }

  console.log("\n[LLM Metadata]:", JSON.stringify(meta));
  console.log("[Tool Invocations Allowed by RBAC]:", toolCalled ? JSON.stringify(toolCalled) : "None (woo__create_product is filtered out of member tool list)");
  console.log("\n[Agent Refusal Response]:\n" + finalContent);

  // Now test direct attempt to execute woo__create_product via core to prove audit log row
  console.log("\nTesting direct tool call attempt for woo__create_product as member to record RBAC rejection audit row...");
  const directTestCode = `
    const { pool } = require('./dist/db/index.js');
    const { executeToolAsUser } = require('./dist/agent/agent-core.js');
    (async () => {
      const user = { id: ${user.id}, email: '${user.email}', role: '${user.role}' };
      const r = await executeToolAsUser(user, 'woo__create_product', { name: 'Direct Attack Product', regular_price: '499' });
      console.log('Core RBAC Rejection:', JSON.stringify(r));
      const auditRes = await pool.query("SELECT id, user_email, tool_name, outcome, error_message FROM audit_logs WHERE user_email = 'member@localtest.me' ORDER BY id DESC LIMIT 1");
      console.log('Audit Row Recorded:', JSON.stringify(auditRes.rows[0], null, 2));
      process.exit(0);
    })();
  `;
  const directOut = execSync(`kubectl -n uai exec deploy/uai-gateway -- node -e "${directTestCode.replace(/\n/g, ' ')}"`, { encoding: "utf-8" });
  console.log(directOut);
}

main().catch(console.error);
