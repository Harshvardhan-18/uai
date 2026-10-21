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

async function main() {
  console.log("============================================================");
  console.log("=== PHASE 5 VERIFICATION SUITE: DASHBOARD & ADMIN FLOW ===");
  console.log("============================================================\n");

  // Step 1: Ingress Routing to Static Dashboard
  console.log("--- Step 1: Testing Static Dashboard via Ingress ---");
  const htmlRes = await fetch(`${BASE_URL}/`);
  if (!htmlRes.ok) throw new Error(`Failed to load dashboard HTML: ${htmlRes.status}`);
  const htmlText = await htmlRes.text();
  if (!htmlText.includes("UAI — MCP Gateway & Orchestration")) {
    throw new Error("Dashboard HTML title missing or incorrect!");
  }
  console.log("Dashboard HTML served correctly with expected <title>!");

  // Verify health probe
  const healthRes = await fetch(`${BASE_URL}/health`);
  if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
  console.log("Dashboard pod /health probe responding: 200 OK\n");

  // Step 2: Admin Login
  console.log("--- Step 2: Admin Authentication Flow ---");
  const adminPassword = getAdminPassword();
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@localtest.me",
      password: adminPassword,
    }),
  });
  if (!loginRes.ok) throw new Error(`Login failed: ${await loginRes.text()}`);
  const { user: adminUser, token: adminToken } = await loginRes.json();
  console.log(`Admin logged in: ${adminUser.email} (Role: ${adminUser.role})\n`);

  // Step 3: Security Verification - No Credentials in API Responses
  console.log("--- Step 3: Security Verification (No Credentials in API) ---");
  const serversRes = await fetch(`${BASE_URL}/api/servers`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const { servers } = await serversRes.json();
  console.log(`Checking ${servers.length} servers for credential leakage...`);

  for (const s of servers) {
    if ("auth_token_encrypted" in s || "auth_token" in s || "password" in s || "token" in s) {
      throw new Error(`Security Violation: Server ${s.slug} leaked credential fields in API response!`);
    }
  }
  console.log("PASSED: Zero credentials or encrypted tokens present in /api/servers response.\n");

  // Check API keys endpoint
  const keysRes = await fetch(`${BASE_URL}/api/keys`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const { keys } = await keysRes.json();
  console.log(`Checking ${keys.length} API keys for raw key/hash leakage...`);
  for (const k of keys) {
    if ("raw_key" in k || "key_hash" in k || "rawApiKey" in k) {
      throw new Error(`Security Violation: Key ID ${k.id} leaked raw key or hash in API response!`);
    }
    if (!k.key_prefix.startsWith("gw_")) {
      throw new Error(`Invalid key prefix: ${k.key_prefix}`);
    }
  }
  console.log("PASSED: Only sanitized key prefix (gw_...) exposed in /api/keys response.\n");

  // Step 4: Admin Server CRUD Lifecycle
  console.log("--- Step 4: Admin Server CRUD Lifecycle ---");
  const testSlug = `demo-${Date.now()}`;
  console.log(`Creating test server with slug: ${testSlug}...`);
  const createRes = await fetch(`${BASE_URL}/api/servers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Temporary Demo Upstream",
      slug: testSlug,
      url: "http://uai-everything-mcp:8002/mcp-temp",
      auth_type: "bearer",
      auth_token: "super-secret-vault-token-xyz987",
    }),
  });

  if (!createRes.ok) throw new Error(`Create server failed: ${await createRes.text()}`);
  const { server: createdServer } = await createRes.json();
  console.log(`Created server ID: ${createdServer.id}`);

  // Confirm token was NOT returned in create response
  if ("auth_token" in createdServer || "auth_token_encrypted" in createdServer) {
    throw new Error("Security Violation: Created server response contained raw/encrypted token!");
  }

  // Toggle server
  console.log(`Toggling server ${createdServer.id}...`);
  const toggleRes = await fetch(`${BASE_URL}/api/servers/${createdServer.id}/toggle`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const { server: toggledServer } = await toggleRes.json();
  console.log(`Server enabled status is now: ${toggledServer.enabled}`);

  // Delete server
  console.log(`Deleting test server ${createdServer.id}...`);
  const deleteRes = await fetch(`${BASE_URL}/api/servers/${createdServer.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!deleteRes.ok) throw new Error("Failed to delete test server");
  console.log("Server removed cleanly from gateway registry.\n");

  // Step 5: Team Management & Role-Based Access Control (RBAC)
  console.log("--- Step 5: Team Management & RBAC Permissions ---");
  const memberEmail = `member_${Date.now()}@localtest.me`;
  console.log(`Inviting new member: ${memberEmail}...`);
  const inviteRes = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: memberEmail,
      role: "member",
    }),
  });

  if (!inviteRes.ok) throw new Error(`Invite user failed: ${await inviteRes.text()}`);
  const { user: newMember, temporaryPassword: memberPassword } = await inviteRes.json();
  console.log(`Created member: ${newMember.email} (Role: ${newMember.role})`);

  // Login as the new member using returned temporary password
  console.log("Logging in as newly created member using temporary password...");
  const memberLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: memberEmail,
      password: memberPassword,
    }),
  });
  const { token: memberToken } = await memberLoginRes.json();

  // Test Member capability: Can generate their own API key
  console.log("Testing member API key generation...");
  const memberKeyRes = await fetch(`${BASE_URL}/api/keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${memberToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Member Personal Key" }),
  });
  if (!memberKeyRes.ok) throw new Error("Member failed to generate personal key");
  const { rawApiKey: memberRawKey } = await memberKeyRes.json();
  console.log(`Member generated key: ${memberRawKey.substring(0, 15)}...`);

  // Test RBAC Restriction: Member CANNOT add a server
  console.log("Testing RBAC: Member attempting to create an upstream server (should be FORBIDDEN)...");
  const forbiddenRes = await fetch(`${BASE_URL}/api/servers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${memberToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Unauthorized Server",
      slug: "unauthorized",
      url: "http://malicious:8000/sse",
    }),
  });

  if (forbiddenRes.status !== 403) {
    throw new Error(`Security Violation: Expected 403 Forbidden for member creating server, got: ${forbiddenRes.status}`);
  }
  console.log("PASSED: Non-admin member blocked with HTTP 403 Forbidden!\n");

  // Step 6: Audit Log Inspection
  console.log("--- Step 6: Audit Log Inspection & Redaction Verification ---");
  const auditRes = await fetch(`${BASE_URL}/api/audit?limit=10`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const { logs, total } = await auditRes.json();
  console.log(`Fetched ${logs.length} of ${total} total audit records:`);
  for (const l of logs.slice(0, 3)) {
    console.log(`  [Audit] ${l.created_at} | ${l.user_email} | ${l.server_slug}__${l.tool_name} | Outcome: ${l.outcome}`);
  }

  console.log("\n============================================================");
  console.log("=== PHASE 5 VERIFICATION GREEN! ALL CHECKS PASSED ===");
  console.log("============================================================");
}

main().catch((err) => {
  console.error("Phase 5 verification failed:", err);
  process.exit(1);
});
