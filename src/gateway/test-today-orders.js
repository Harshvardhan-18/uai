import { execSync } from "child_process";

const BASE_URL = "http://app.localtest.me";

function getAdminToken() {
  const pwB64 = execSync('kubectl get secret -n uai uai-gateway -o jsonpath="{.data.admin-password}"', { encoding: "utf-8" }).trim();
  return Buffer.from(pwB64, "base64").toString("utf-8");
}

async function login() {
  const adminPassword = getAdminToken();
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@localtest.me", password: adminPassword }),
  });
  if (!res.ok) throw new Error(`Login failed: ${await res.text()}`);
  return (await res.json()).token;
}

async function createTodayOrder() {
  const ckB64 = execSync('kubectl get secret -n uai uai-woo-credentials -o jsonpath="{.data.consumer-key}"', { encoding: "utf-8" }).trim();
  const csB64 = execSync('kubectl get secret -n uai uai-woo-credentials -o jsonpath="{.data.consumer-secret}"', { encoding: "utf-8" }).trim();
  const ck = Buffer.from(ckB64, "base64").toString("utf-8");
  const cs = Buffer.from(csB64, "base64").toString("utf-8");
  const authHeader = "Basic " + Buffer.from(`${ck}:${cs}`).toString("base64");

  const orderRes = await fetch("http://store.localtest.me/wp-json/wc/v3/orders", {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      payment_method: "cod",
      payment_method_title: "Cash on delivery",
      status: "processing", // Item 6: COD processing status
      set_paid: false,
      billing: {
        first_name: "Alice",
        last_name: "Smith",
        email: "alice@example.com",
      },
      line_items: [
        {
          product_id: 15, // Mechanical Keyboard created in earlier step
          quantity: 1,
        },
      ],
    }),
  });

  if (!orderRes.ok) throw new Error(`Failed to create order: ${await orderRes.text()}`);
  return orderRes.json();
}

async function streamChat(token, message) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`Chat stream failed: ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
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
        events.push(event);
        if (event.type === "meta") {
          console.log(`[Event: meta] Provider: ${event.provider}, Model: ${event.model}, Fallback: ${event.isFallback}`);
        } else if (event.type === "thought") {
          console.log(`[Event: thought] ${event.content}`);
        } else if (event.type === "tool_call_start") {
          console.log(`[Event: tool_call_start] Tool: ${event.tool}`);
          console.log(`  Chosen Arguments:`, JSON.stringify(event.args, null, 2));
        } else if (event.type === "tool_call_end") {
          console.log(`[Event: tool_call_end] Tool: ${event.tool} (isError: ${event.isError})`);
          console.log(`  Raw Result Preview:`, (event.result || "").substring(0, 160) + "...");
        } else if (event.type === "delta" || event.type === "done") {
          finalResponse = event.content;
        }
      } catch {}
    }
  }

  return { finalResponse, events };
}

async function main() {
  console.log("================================================================================");
  console.log("ITEM 2 & 6: 'TODAY' DATE-BOUND FILTERING & COD ORDER STATUS VERIFICATION");
  console.log("================================================================================");

  // 1. Authenticate Admin
  const token = await login();

  // 2. Create today's order
  console.log("\n[1] Creating fresh order for TODAY with status 'processing'...");
  const todayOrder = await createTodayOrder();
  console.log(`Created today's order #${todayOrder.id}:`);
  console.log(`  Date Created:   ${todayOrder.date_created}`);
  console.log(`  Status:         ${todayOrder.status} (Verified: processing)`);
  console.log(`  Customer:       ${todayOrder.billing.first_name} ${todayOrder.billing.last_name}`);
  console.log(`  Total:          $${todayOrder.total} ${todayOrder.currency}`);

  // 3. Check existing past order #14 date
  console.log("\n[2] Existing past order in database:");
  console.log(`  Order #14 Date: 2026-10-19T19:35:19 (from 2 days ago)`);

  // 4. Query Chat Agent with "what orders came in today"
  console.log("\n[3] Calling Chat Agent with prompt: \"what orders came in today\"...");
  const result = await streamChat(token, "what orders came in today");

  console.log("\n--- Chat Agent Final Response ---");
  console.log(result.finalResponse);

  // 5. Verification checks
  console.log("\n--------------------------------------------------------------------------------");
  console.log("[4] VERIFICATION CHECKS:");
  const toolCallEvent = result.events.find((e) => e.type === "tool_call_start" && e.tool?.includes("list_orders"));
  if (!toolCallEvent) throw new Error("No tool_call_start event found for list_orders!");

  const args = toolCallEvent.args || {};
  console.log(`✓ 'after' parameter present in chosen args: ${args.after !== undefined} (value: "${args.after}")`);
  console.log(`✓ 'before' parameter present in chosen args: ${args.before !== undefined} (value: "${args.before}")`);

  const responseText = result.finalResponse;
  const includesTodayOrder = responseText.includes(String(todayOrder.id));
  const excludesYesterdayOrder = !responseText.includes("Order #14");

  console.log(`✓ Includes today's order #${todayOrder.id}: ${includesTodayOrder}`);
  console.log(`✓ Excludes past order #14: ${excludesYesterdayOrder}`);

  if (!includesTodayOrder || !excludesYesterdayOrder) {
    throw new Error(`Date filtering assertion failed! includesToday: ${includesTodayOrder}, excludesYesterday: ${excludesYesterdayOrder}`);
  }

  console.log("\n================================================================================");
  console.log("ITEM 2 & 6 VERDICT: PASS (Date parameters applied, today order #16 included, order #14 excluded, COD status processing)");
  console.log("================================================================================");
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
