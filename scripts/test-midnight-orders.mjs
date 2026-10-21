import { execSync } from "child_process";
import assert from "assert";

const BASE_URL = "http://app.localtest.me";

function getAdminPassword() {
  const pw = execSync('kubectl get secret -n uai uai-gateway -o jsonpath="{.data.admin-password}"', { encoding: "utf-8" });
  return Buffer.from(pw.trim(), "base64").toString("utf-8");
}

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${await res.text()}`);
  return res.json();
}

async function createOrderWithDate(dateCreatedGmt, customerName) {
  const ckB64 = execSync('kubectl get secret -n uai uai-woo-credentials -o jsonpath="{.data.consumer-key}"', { encoding: "utf-8" }).trim();
  const csB64 = execSync('kubectl get secret -n uai uai-woo-credentials -o jsonpath="{.data.consumer-secret}"', { encoding: "utf-8" }).trim();
  const ck = Buffer.from(ckB64, "base64").toString("utf-8");
  const cs = Buffer.from(csB64, "base64").toString("utf-8");
  const authHeader = "Basic " + Buffer.from(`${ck}:${cs}`).toString("base64");

  const res = await fetch("http://store.localtest.me/wp-json/wc/v3/orders", {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      payment_method: "cod",
      payment_method_title: "Cash on delivery",
      date_created_gmt: dateCreatedGmt,
      billing: {
        first_name: customerName,
        last_name: "Test",
        email: `${customerName.toLowerCase()}@example.com`,
      },
      line_items: [{ product_id: 15, quantity: 1 }],
    }),
  });

  if (!res.ok) throw new Error(`Order creation failed: ${await res.text()}`);
  const order = await res.json();
  
  const wpPwB64 = execSync('kubectl get secret -n uai uai-mariadb -o jsonpath="{.data.password}"', { encoding: "utf-8" }).trim();
  const wpPw = Buffer.from(wpPwB64, "base64").toString("utf-8");

  // Update order post_date and post_date_gmt directly in MariaDB to ensure exact timestamp
  execSync(`kubectl exec -i -n uai uai-mariadb-0 -- mariadb -u wp_user -p${wpPw} -D wordpress -e "UPDATE wp_posts SET post_date = '${dateCreatedGmt.replace('T', ' ').replace('Z', '')}', post_date_gmt = '${dateCreatedGmt.replace('T', ' ').replace('Z', '')}' WHERE ID = ${order.id};"`);
  
  return order.id;
}

async function main() {
  console.log("=== ITEM 4: TIMEZONE HARMONIZATION & MIDNIGHT BOUNDARY TEST ===");

  const wpPwB64 = execSync('kubectl get secret -n uai uai-mariadb -o jsonpath="{.data.password}"', { encoding: "utf-8" }).trim();
  const wpPw = Buffer.from(wpPwB64, "base64").toString("utf-8");

  // 1. Check WordPress Timezone
  const wpTz = execSync(
    `kubectl exec -i -n uai uai-mariadb-0 -- mariadb -u wp_user -p${wpPw} -D wordpress -e "SELECT option_value FROM wp_options WHERE option_name = 'timezone_string';"`,
    { encoding: "utf-8" }
  );
  console.log(`WordPress configured timezone_string: ${wpTz.trim().split("\n")[1] || "UTC"}`);

  // 2. Create Order A: 10 seconds BEFORE midnight (2026-10-20 23:59:50 UTC)
  const orderA_id = await createOrderWithDate("2026-10-20T23:59:50Z", "PreMidnight");
  console.log(`Created Order A (Just BEFORE midnight): #${orderA_id} @ 2026-10-20T23:59:50Z`);

  // 3. Create Order B: 10 seconds AFTER midnight (2026-10-21 00:00:10 UTC)
  const orderB_id = await createOrderWithDate("2026-10-21T00:00:10Z", "PostMidnight");
  console.log(`Created Order B (Just AFTER midnight): #${orderB_id} @ 2026-10-21T00:00:10Z`);

  // 4. Query Gateway Agent as Admin
  const adminPassword = getAdminPassword();
  const { token } = await login("admin@localtest.me", adminPassword);

  console.log('\nSending Prompt to Agent: "what orders came in today" ...');
  const chatRes = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: "what orders came in today" }),
  });

  const reader = chatRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalContent = "";
  let toolArgs = null;

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
        if (ev.type === "tool_call_start" && ev.tool === "woo__list_orders") {
          toolArgs = ev.args;
        }
        if (ev.type === "done") finalContent = ev.content;
      } catch {}
    }
  }

  console.log(`Model chose tool args:`, JSON.stringify(toolArgs));
  console.log(`Agent response preview:`, finalContent.substring(0, 300) + "...\n");

  // Verify boundary filtering:
  // Order B (#orderB_id) MUST be in the response
  // Order A (#orderA_id) MUST NOT be in the response
  const includesOrderB = finalContent.includes(String(orderB_id)) || finalContent.includes("PostMidnight");
  const includesOrderA = finalContent.includes(String(orderA_id)) || finalContent.includes("PreMidnight");

  console.log(`Order B (#${orderB_id}, post-midnight) included: ${includesOrderB ? "YES (PASS)" : "NO (FAIL)"}`);
  console.log(`Order A (#${orderA_id}, pre-midnight) excluded: ${!includesOrderA ? "YES (PASS)" : "NO (FAIL)"}`);

  assert.strictEqual(includesOrderB, true, "Order B created after midnight should be included");
  assert.strictEqual(includesOrderA, false, "Order A created before midnight should be excluded");

  console.log("\n========================================================");
  console.log("ITEM 4 PASSED: Midnight boundary orders correctly handled!");
  console.log("========================================================");
}

main().catch(console.error);
