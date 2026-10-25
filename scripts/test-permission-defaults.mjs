import { execSync } from "child_process";
import assert from "assert";

const BASE_URL = "http://app.localtest.me";

function getAdminPassword() {
  const pw = execSync('kubectl get secret -n uai uai-gateway -o jsonpath="{.data.admin-password}"', { encoding: "utf-8" });
  return Buffer.from(pw.trim(), "base64").toString("utf-8");
}

async function loginAdmin() {
  const password = getAdminPassword();
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@localtest.me", password }),
  });
  if (!res.ok) throw new Error(`Admin login failed: ${await res.text()}`);
  return res.json();
}

async function ensureAndLoginMember() {
  const password = getAdminPassword();
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "member@localtest.me", password }),
  });
  if (!res.ok) throw new Error(`Member login failed: ${await res.text()}`);
  return (await res.json()).token;
}

async function main() {
  console.log("================================================================================");
  console.log("TASK 6: PERMISSION DEFAULTS (NEW UPSTREAM SERVERS DEFAULT TO ADMIN-ONLY)");
  console.log("================================================================================");

  const { token: adminToken } = await loginAdmin();
  const memberToken = await ensureAndLoginMember();

  // 1. Register a new test upstream server as Admin
  console.log("\n[1] Registering new test upstream server 'test-calc' (defaults to admin-only)...");
  const createRes = await fetch(`${BASE_URL}/api/servers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: "Test Calculator",
      slug: "test_calc",
      url: "http://uai-utils-mcp:8001/mcp",
    }),
  });

  const createData = await createRes.json();
  assert.ok(createRes.ok, `Server creation failed: ${JSON.stringify(createData)}`);
  const serverId = createData.server.id;
  console.log(`[PASS] Server created: ID = ${serverId}, Slug = ${createData.server.slug}, member_access = ${createData.server.member_access}`);
  assert.strictEqual(createData.server.member_access, false, "New server MUST default to member_access = false (admin-only)");

  // 2. Query tools as Admin
  console.log("\n[2] Checking tools visible to Admin...");
  const adminToolsRes = await fetch(`${BASE_URL}/api/servers/tools`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const { tools: adminTools } = await adminToolsRes.json();
  const adminHasTestTool = adminTools.some((t) => t.name.startsWith("test_calc__"));
  console.log(`[PASS] Admin sees test_calc tools: ${adminHasTestTool} (Total admin tools: ${adminTools.length})`);
  assert.ok(adminHasTestTool, "Admin MUST be able to see newly added server's tools");

  // 3. Query tools as Member
  console.log("\n[3] Checking tools visible to Member (before allowing)...");
  const memberToolsRes1 = await fetch(`${BASE_URL}/api/servers/tools`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  const { tools: memberTools1 } = await memberToolsRes1.json();
  const memberHasTestTool1 = memberTools1.some((t) => t.name.startsWith("test_calc__"));
  console.log(`[PASS] Member sees test_calc tools: ${memberHasTestTool1} (HIDDEN from member)`);
  assert.strictEqual(memberHasTestTool1, false, "New server tools MUST be hidden from member by default");

  // 4. Admin updates permissions to ALLOW member access
  console.log("\n[4] Admin grants member access via PATCH /api/servers/:id/permissions...");
  const patchRes = await fetch(`${BASE_URL}/api/servers/${serverId}/permissions`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ member_access: true }),
  });
  const patchData = await patchRes.json();
  assert.ok(patchRes.ok, `PATCH permissions failed: ${JSON.stringify(patchData)}`);
  console.log(`[PASS] Permissions updated: member_access = ${patchData.server.member_access}`);
  assert.strictEqual(patchData.server.member_access, true, "member_access must be updated to true");

  // 5. Query tools as Member again (after allowing)
  console.log("\n[5] Checking tools visible to Member (after allowing)...");
  const memberToolsRes2 = await fetch(`${BASE_URL}/api/servers/tools`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  const { tools: memberTools2 } = await memberToolsRes2.json();
  const memberHasTestTool2 = memberTools2.some((t) => t.name.startsWith("test_calc__"));
  console.log(`[PASS] Member sees test_calc tools: ${memberHasTestTool2} (ALLOWED for member)`);
  assert.ok(memberHasTestTool2, "Member MUST now be able to see test_calc tools");

  // 6. Clean up: Delete test server
  console.log("\n[6] Removing test server...");
  const delRes = await fetch(`${BASE_URL}/api/servers/${serverId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.ok(delRes.ok, "Delete server must succeed");
  console.log("[PASS] Test server deleted cleanly.");

  console.log("\n================================================================================");
  console.log("TASK 6 VERDICT: PASS (New upstream defaulted to admin-only, hidden from member, then allowed, then removed)");
  console.log("================================================================================\n");
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
