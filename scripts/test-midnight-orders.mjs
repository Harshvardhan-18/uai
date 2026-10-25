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
      status: "processing",
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

  // Format GMT date for MariaDB
  const gmtSqlDate = dateCreatedGmt.replace("T", " ").replace("Z", "");
  // Calculate local IST date (+5:30)
  const gmtTime = new Date(dateCreatedGmt).getTime();
  const localIstDate = new Date(gmtTime + 5.5 * 3600 * 1000).toISOString().replace("T", " ").replace("Z", "").substring(0, 19);

  // Update order post_date and post_date_gmt directly in MariaDB
  execSync(`kubectl exec -i -n uai uai-mariadb-0 -- mariadb -u wp_user -p${wpPw} -D wordpress -e "UPDATE wp_posts SET post_date = '${localIstDate}', post_date_gmt = '${gmtSqlDate}' WHERE ID = ${order.id};"`);
  
  return order.id;
}

async function main() {
  console.log("================================================================================");
  console.log("TASK 10: TIMEZONE HARMONIZATION & ASIA/KOLKATA MIDNIGHT BOUNDARY TEST");
  console.log("================================================================================");

  const wpPwB64 = execSync('kubectl get secret -n uai uai-mariadb -o jsonpath="{.data.password}"', { encoding: "utf-8" }).trim();
  const wpPw = Buffer.from(wpPwB64, "base64").toString("utf-8");

  // 1. Check WordPress Timezone
  const wpTz = execSync(
    `kubectl exec -i -n uai uai-mariadb-0 -- mariadb -u wp_user -p${wpPw} -D wordpress -N -e "SELECT option_value FROM wp_options WHERE option_name = 'timezone_string';"`,
    { encoding: "utf-8" }
  );
  console.log(`WordPress configured timezone_string: ${wpTz.trim()}`);
  assert.strictEqual(wpTz.trim(), "Asia/Kolkata", "WordPress timezone must be configured as Asia/Kolkata");

  // 2. Compute dynamic IST Midnight Boundary for today
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayIst = formatter.format(now); // e.g. "2026-10-25"
  
  // Start of today in IST in UTC milliseconds
  const istMidnightEpoch = new Date(`${todayIst}T00:00:00+05:30`).getTime();
  const preMidnightIso = new Date(istMidnightEpoch - 10000).toISOString(); // 10s before IST midnight
  const postMidnightIso = new Date(istMidnightEpoch + 10000).toISOString(); // 10s after IST midnight

  console.log(`Today in Asia/Kolkata:            ${todayIst}`);
  console.log(`Local IST Midnight in UTC:        ${new Date(istMidnightEpoch).toISOString()}`);
  console.log(`Order A (10s before IST midnight): ${preMidnightIso}`);
  console.log(`Order B (10s after IST midnight):  ${postMidnightIso}`);

  const orderA_id = await createOrderWithDate(preMidnightIso, "PreMidnightIST");
  console.log(`Created Order A (Just BEFORE IST midnight): #${orderA_id} @ ${preMidnightIso}`);

  const orderB_id = await createOrderWithDate(postMidnightIso, "PostMidnightIST");
  console.log(`Created Order B (Just AFTER IST midnight):  #${orderB_id} @ ${postMidnightIso}`);

  // 3. Query Gateway Agent as Admin
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

  console.log(`\nModel chose tool args:`, JSON.stringify(toolArgs));
  console.log(`Agent response preview:\n${finalContent.substring(0, 350)}...\n`);

  assert.ok(toolArgs, "Agent must call woo__list_orders");
  assert.ok(toolArgs.after, "Agent must supply after parameter for today filter");

  const orderAExcluded = !finalContent.includes(String(orderA_id));
  const orderBIncluded = finalContent.includes(String(orderB_id));

  console.log("Boundary Assertion Verification:");
  console.log(`- Order A (#${orderA_id}) from before IST midnight excluded: ${orderAExcluded}`);
  console.log(`- Order B (#${orderB_id}) from after IST midnight included:  ${orderBIncluded}`);

  assert.ok(orderAExcluded, `Order A (#${orderA_id}) must be excluded from today's orders`);
  assert.ok(orderBIncluded, `Order B (#${orderB_id}) must be included in today's orders`);

  // Cleanup test orders
  execSync(`kubectl exec -i -n uai uai-mariadb-0 -- mariadb -u wp_user -p${wpPw} -D wordpress -e "DELETE FROM wp_posts WHERE ID IN (${orderA_id}, ${orderB_id}); DELETE FROM wp_postmeta WHERE post_id IN (${orderA_id}, ${orderB_id});"`);
  console.log(`[PASS] Cleaned up temporary boundary orders #${orderA_id} and #${orderB_id}.`);

  console.log("\n================================================================================");
  console.log("TASK 10 VERDICT: PASS (Asia/Kolkata midnight boundary test verified; Order A excluded, Order B included)");
  console.log("================================================================================\n");
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
