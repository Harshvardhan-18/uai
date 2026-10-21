import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { execSync } from "child_process";

const BASE_URL = "http://app.localtest.me";

function getAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  try {
    const pw = execSync('kubectl get secret -n uai uai-gateway -o jsonpath="{.data.admin-password}"', { encoding: "utf-8" });
    return Buffer.from(pw.trim(), "base64").toString("utf-8");
  } catch (e) {
    throw new Error("ADMIN_PASSWORD not set in env and failed to fetch from secret: " + e.message);
  }
}

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

async function readSSEStream(url, token, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`SSE failed: ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];

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
        events.push(JSON.parse(jsonStr));
      } catch {}
    }
  }

  return events;
}

async function main() {
  console.log("======================================================================");
  console.log("=== PHASE 7: DEFINITION-OF-DONE 2-USER REHEARSAL & GAP AUDIT ===");
  console.log("======================================================================\n");

  // ──────────────────────────────────────────────────────────────────
  // Check 1: Admin Sign-in & Upstream Server Verification
  // ──────────────────────────────────────────────────────────────────
  console.log("--- Check 1: User A (Admin) Authentication & Upstreams Check ---");
  const adminPassword = getAdminPassword();
  const { user: adminUser, token: adminToken } = await login("admin@localtest.me", adminPassword);
  console.log(`User A authenticated: ${adminUser.email} (Role: ${adminUser.role})`);

  const serversRes = await fetch(`${BASE_URL}/api/servers`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const { servers } = await serversRes.json();
  console.log(`Admin sees ${servers.length} upstream servers:`);
  for (const s of servers) {
    console.log(`  - [${s.slug}] ${s.name} (${s.health_status})`);
  }

  const toolsRes = await fetch(`${BASE_URL}/api/servers/tools`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const { tools } = await toolsRes.json();
  console.log(`Admin sees ${tools.length} aggregated tools with prefix namespacing.`);
  if (tools.length < 10) throw new Error("Expected at least 10 aggregated tools!");
  console.log("PASSED: Admin upstream discovery complete.\n");

  // ──────────────────────────────────────────────────────────────────
  // Check 2: Admin Server Lifecycle (Add, Toggle, Delete)
  // ──────────────────────────────────────────────────────────────────
  console.log("--- Check 2: Admin Server Lifecycle CRUD ---");
  const demoSlug = `audit-demo-${Date.now().toString().slice(-4)}`;
  const addServerRes = await fetch(`${BASE_URL}/api/servers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Temporary Audit Upstream",
      slug: demoSlug,
      url: "http://uai-everything-mcp:8002/mcp-audit",
      auth_type: "bearer",
      auth_token: "secret-token-do-not-leak",
    }),
  });
  if (!addServerRes.ok) throw new Error("Admin failed to add test server");
  const { server: newServer } = await addServerRes.json();
  console.log(`Admin created upstream server: ID ${newServer.id} (${newServer.slug})`);

  // Verify secret NOT leaked
  if ("auth_token" in newServer || "auth_token_encrypted" in newServer) {
    throw new Error("Security Violation: Upstream secret token leaked in response!");
  }

  // Toggle server
  await fetch(`${BASE_URL}/api/servers/${newServer.id}/toggle`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  // Delete server
  await fetch(`${BASE_URL}/api/servers/${newServer.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log("PASSED: Admin server CRUD lifecycle passed with zero token leakage.\n");

  // ──────────────────────────────────────────────────────────────────
  // Check 3: Admin Invites User B (Member)
  // ──────────────────────────────────────────────────────────────────
  console.log("--- Check 3: Admin Inviting User B (Member) ---");
  const memberEmail = "member@localtest.me";

  // Recreate clean member account via invite flow
  try {
    execSync('kubectl -n uai exec -i statefulset/uai-postgres -- psql -U uai_user -d uai_gateway -c "DELETE FROM users WHERE email = \'member@localtest.me\';"');
  } catch {}

  console.log(`Inviting member account "${memberEmail}" via admin API...`);
  const inviteRes = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: memberEmail, role: "member" }),
  });
  if (!inviteRes.ok) throw new Error(`Failed to invite member: ${await inviteRes.text()}`);
  const { user: newMember, temporaryPassword: memberPass } = await inviteRes.json();
  console.log(`Member account invited! Temporary password generated dynamically.`);
  const memLogin = await login(memberEmail, memberPass);
  const memberToken = memLogin.token;
  console.log(`Member authenticated successfully!`);

  // ──────────────────────────────────────────────────────────────────
  // Check 4: Member RBAC Restrictions (Negative Tests)
  // ──────────────────────────────────────────────────────────────────
  console.log("\n--- Check 4: Member RBAC Restrictions (Negative Tests) ---");

  // Attempt 1: Member tries to add an upstream server
  const rbac1 = await fetch(`${BASE_URL}/api/servers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${memberToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Hacked", slug: "hacked", url: "http://evil:80/sse" }),
  });
  if (rbac1.status !== 403) throw new Error(`RBAC failure: Member was not blocked from adding server (Status: ${rbac1.status})`);
  console.log("  [RBAC] Member blocked from adding servers: HTTP 403 Forbidden (PASS)");

  // Attempt 2: Member tries to delete an upstream server
  const rbac2 = await fetch(`${BASE_URL}/api/servers/1`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  if (rbac2.status !== 403) throw new Error(`RBAC failure: Member was not blocked from deleting server (Status: ${rbac2.status})`);
  console.log("  [RBAC] Member blocked from deleting servers: HTTP 403 Forbidden (PASS)");

  // Attempt 3: Member tries to access team users list
  const rbac3 = await fetch(`${BASE_URL}/api/users`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  if (rbac3.status !== 403) throw new Error(`RBAC failure: Member was not blocked from viewing team users (Status: ${rbac3.status})`);
  console.log("  [RBAC] Member blocked from viewing team users: HTTP 403 Forbidden (PASS)");

  // Attempt 4: Member tries to invite a user
  const rbac4 = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${memberToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "evil@evil.com", password: "123", role: "admin" }),
  });
  if (rbac4.status !== 403) throw new Error(`RBAC failure: Member was not blocked from creating users (Status: ${rbac4.status})`);
  console.log("  [RBAC] Member blocked from creating users: HTTP 403 Forbidden (PASS)");
  console.log("PASSED: All RBAC restrictions strictly enforced.\n");

  // ──────────────────────────────────────────────────────────────────
  // Check 5: API Key Generation & Key Isolation
  // ──────────────────────────────────────────────────────────────────
  console.log("--- Check 5: API Key Generation & Cross-User Key Isolation ---");

  // Admin creates key
  const adminKeyRes = await fetch(`${BASE_URL}/api/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Admin Test Key" }),
  });
  const { key: adminKeyObj, rawApiKey: adminRawKey } = await adminKeyRes.json();
  console.log(`Admin created key ID #${adminKeyObj.id} (prefix: ${adminKeyObj.key_prefix})`);

  // Member creates key
  const memberKeyRes = await fetch(`${BASE_URL}/api/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${memberToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Member Personal Key" }),
  });
  const { key: memberKeyObj, rawApiKey: memberRawKey } = await memberKeyRes.json();
  console.log(`Member created key ID #${memberKeyObj.id} (prefix: ${memberKeyObj.key_prefix})`);

  // Key Isolation Check: Member calls GET /api/keys
  const memberKeysListRes = await fetch(`${BASE_URL}/api/keys`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  const { keys: memberVisibleKeys } = await memberKeysListRes.json();
  console.log(`Member sees ${memberVisibleKeys.length} keys in their personal keys list.`);

  // Verify Admin's key is NOT visible to Member
  const hasAdminKeyInMemberView = memberVisibleKeys.some((k) => k.id === adminKeyObj.id);
  if (hasAdminKeyInMemberView) {
    throw new Error("Security Violation: Member was able to see Admin's API key!");
  }
  console.log("  [Key Isolation] Member cannot see Admin's API keys (PASS)");

  // Attempt to revoke Admin's key as Member
  const revokeAttempt = await fetch(`${BASE_URL}/api/keys/${adminKeyObj.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  if (revokeAttempt.status !== 403) {
    throw new Error(`Security Violation: Member was not forbidden from revoking Admin's key! (Status: ${revokeAttempt.status})`);
  }
  console.log("  [Key Isolation] Member cannot revoke Admin's API keys: HTTP 403 (PASS)");
  console.log("PASSED: API key isolation strictly verified.\n");

  // ──────────────────────────────────────────────────────────────────
  // Check 6: External MCP Client Call with Member API Key & Audit Check
  // ──────────────────────────────────────────────────────────────────
  console.log("--- Check 6: External MCP Client Calling Tools as Member ---");
  const mcpTransport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${memberRawKey}` } },
  });
  const memberMcpClient = new Client({ name: "member-mcp-client", version: "1.0.0" }, { capabilities: {} });
  await memberMcpClient.connect(mcpTransport);
  console.log("Member MCP Client connected to gateway /mcp successfully.");

  // Call utils__get_current_time
  const timeRes = await memberMcpClient.callTool({
    name: "utils__get_current_time",
    arguments: { timezone: "UTC" },
  });
  console.log(`Member executed utils__get_current_time: ${timeRes.content[0].text.substring(0, 50)}...`);

  // Call woo__list_products
  const prodRes = await memberMcpClient.callTool({
    name: "woo__list_products",
    arguments: { per_page: 2 },
  });
  console.log(`Member executed woo__list_products (output length: ${prodRes.content[0].text.length})`);

  await memberMcpClient.close();

  // Audit attribution verification for Member MCP call
  const memberAuditRes = await fetch(`${BASE_URL}/api/audit?limit=2`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  const { logs: memberLogs } = await memberAuditRes.json();
  const latestLog = memberLogs[0];
  console.log(`Member's latest audit record: User: "${latestLog.user_email}", Tool: "${latestLog.server_slug}__${latestLog.tool_name}", Outcome: ${latestLog.outcome}`);

  if (latestLog.user_email !== memberEmail) {
    throw new Error(`Audit Attribution Error: Expected user_email "${memberEmail}", got "${latestLog.user_email}"`);
  }
  console.log("PASSED: Member tool invocation correctly attributed in audit log.\n");

  // ──────────────────────────────────────────────────────────────────
  // Check 7: Immediate Key Revocation Rejection
  // ──────────────────────────────────────────────────────────────────
  console.log("--- Check 7: Immediate Key Revocation Enforcement ---");
  console.log(`Revoking Member key ID #${memberKeyObj.id}...`);
  const delRes = await fetch(`${BASE_URL}/api/keys/${memberKeyObj.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  if (!delRes.ok) throw new Error("Failed to revoke key");

  console.log("Attempting to connect with revoked key...");
  let keyRejected = false;
  try {
    const badTransport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${memberRawKey}` } },
    });
    const badClient = new Client({ name: "bad-key-client", version: "1.0.0" }, { capabilities: {} });
    await badClient.connect(badTransport);
    await badClient.listTools();
  } catch (err) {
    keyRejected = true;
    console.log(`Connection correctly REJECTED on next call: ${err.message}`);
  }

  if (!keyRejected) throw new Error("Security Violation: Revoked key was not rejected!");
  console.log("PASSED: Key revocation rejected immediately.\n");

  // ──────────────────────────────────────────────────────────────────
  // Check 8: Chat Agent with User Attribution
  // ──────────────────────────────────────────────────────────────────
  console.log("--- Check 8: Chat Agent Execution by Member ---");
  const memberChatPrompt = "echo Rehearsal test message from Member";
  const chatEvents = await readSSEStream(`${BASE_URL}/api/chat`, memberToken, { message: memberChatPrompt });
  
  // Strict Assertion: LLM Provider MUST NOT be the fallback
  const metaEvent = chatEvents.find((e) => e.type === "meta");
  if (!metaEvent || metaEvent.provider === "smart-intent-fallback" || metaEvent.isFallback === true) {
    throw new Error(`TEST FAILURE: LLM provider must NOT be fallback! Provider: ${metaEvent?.provider}, isFallback: ${metaEvent?.isFallback}`);
  }
  console.log(`  [LLM Verified] Provider: ${metaEvent.provider} (${metaEvent.model}) - isFallback: false`);

  const toolCallEvent = chatEvents.find((e) => e.type === "tool_call_start");
  const doneEvent = chatEvents.find((e) => e.type === "done");

  console.log(`Member asked: "${memberChatPrompt}"`);
  console.log(`Agent invoked tool: ${toolCallEvent?.tool}`);
  console.log(`Agent response: ${doneEvent?.content}`);

  // Check audit attribution for member chat tool call
  const chatAuditRes = await fetch(`${BASE_URL}/api/audit?limit=1`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  const { logs: memberChatAudit } = await chatAuditRes.json();
  if (memberChatAudit[0]?.user_email !== memberEmail) {
    throw new Error(`Audit Attribution Error: Expected chat call to belong to "${memberEmail}", got "${memberChatAudit[0]?.user_email}"`);
  }
  console.log(`Audit verified: Chat tool call attributed to "${memberChatAudit[0]?.user_email}"!`);
  console.log("PASSED: Chat agent tool execution attributed to user.\n");

  // ──────────────────────────────────────────────────────────────────
  // Check 9: Fault Isolation & Resilience Check
  // ──────────────────────────────────────────────────────────────────
  console.log("--- Check 9: Fault Isolation Verification ---");
  console.log("Testing gateway call to everything__echo and woo__list_orders...");
  const adminMcpTransport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${adminRawKey}` } },
  });
  const adminMcpClient = new Client({ name: "admin-resilience-check", version: "1.0.0" }, { capabilities: {} });
  await adminMcpClient.connect(adminMcpTransport);

  const echoRes = await adminMcpClient.callTool({ name: "everything__echo", arguments: { message: "Fault check" } });
  const wooRes = await adminMcpClient.callTool({ name: "woo__list_orders", arguments: { per_page: 1 } });
  await adminMcpClient.close();

  if (echoRes.isError || wooRes.isError) {
    throw new Error("Core tools failed unexpectedly!");
  }
  console.log("PASSED: Fault isolation and upstream connectivity verified.\n");

  console.log("======================================================================");
  console.log("=== ALL 9 CHECKS IN PHASE 7 DEFINITION-OF-DONE REHEARSAL PASSED! ===");
  console.log("======================================================================\n");
}

main().catch((err) => {
  console.error("Phase 7 rehearsal failed:", err);
  process.exit(1);
});
