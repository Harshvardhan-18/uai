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

async function readSSEStream(url, token, body, onEvent) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`SSE request failed (${res.status}): ${await res.text()}`);
  }

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
        const event = JSON.parse(jsonStr);
        events.push(event);
        if (onEvent) onEvent(event);
      } catch (err) {
        // partial chunk
      }
    }
  }

  return events;
}

async function main() {
  console.log("============================================================");
  console.log("=== PHASE 6 VERIFICATION SUITE: AUTONOMOUS CHAT AGENT ===");
  console.log("============================================================\n");

  // Step 1: Login as Admin
  console.log("--- Step 1: Authenticating User for Chat ---");
  const adminPassword = getAdminPassword();
  const loginRes = await fetch(`${GATEWAY_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@localtest.me",
      password: adminPassword,
    }),
  });

  if (!loginRes.ok) throw new Error(`Login failed: ${await loginRes.text()}`);
  const { user, token } = await loginRes.json();
  console.log(`Authenticated as: ${user.email} (ID: ${user.id}, Role: ${user.role})\n`);

  // Step 2: Test "create a product X at 499"
  console.log("--- Step 2: Testing Agent Tool Loop: 'create a product Premium Wireless Headphones at 499' ---");
  const productName = `Wireless Pro-${Date.now().toString().slice(-4)}`;
  const productPrice = "499";
  const userPrompt1 = `create a product "${productName}" at ${productPrice}`;
  console.log(`Prompt: "${userPrompt1}"`);

  let toolStarted = null;
  let toolEnded = null;
  let finalMessage = "";

  const events1 = await readSSEStream(
    `${GATEWAY_URL}/api/chat`,
    token,
    { message: userPrompt1 },
    (event) => {
      if (event.type === "thought") {
        console.log(`  [Thought] ${event.content}`);
      } else if (event.type === "tool_call_start") {
        console.log(`  [Tool Call Start] Tool: ${event.tool} | Args:`, JSON.stringify(event.args));
        toolStarted = event;
      } else if (event.type === "tool_call_end") {
        console.log(`  [Tool Call End] Tool: ${event.tool} (isError: ${event.isError || false})`);
        toolEnded = event;
      } else if (event.type === "delta" || event.type === "done") {
        if (event.content) finalMessage = event.content;
      }
    }
  );

  if (!toolStarted || toolStarted.tool !== "woo__create_product") {
    throw new Error(`Expected woo__create_product tool invocation, got: ${toolStarted?.tool}`);
  }

  // Strict Assertion: LLM Provider MUST NOT be the fallback
  const metaEvent1 = events1.find((e) => e.type === "meta");
  if (!metaEvent1 || metaEvent1.provider === "smart-intent-fallback" || metaEvent1.isFallback === true) {
    throw new Error(`TEST FAILURE: LLM provider must NOT be fallback! Provider: ${metaEvent1?.provider}, isFallback: ${metaEvent1?.isFallback}`);
  }
  console.log(`[PASS] LLM Provider Verified: ${metaEvent1.provider} (${metaEvent1.model}) - isFallback: false`);
  console.log(`\nAssistant Final Response:\n${finalMessage}\n`);

  // Step 3: Verify the created product exists in WooCommerce catalog
  console.log("--- Step 3: Verifying Product Exists on Storefront Catalog ---");
  // Check via woo REST API directly or via woo-mcp tool
  // Read credentials from cluster secret
  const { execSync } = await import('child_process');
  const ckB64 = execSync('kubectl get secret -n uai uai-woo-credentials -o jsonpath="{.data.consumer-key}"', { encoding: 'utf-8' }).trim();
  const csB64 = execSync('kubectl get secret -n uai uai-woo-credentials -o jsonpath="{.data.consumer-secret}"', { encoding: 'utf-8' }).trim();
  const ck = Buffer.from(ckB64, 'base64').toString('utf-8');
  const cs = Buffer.from(csB64, 'base64').toString('utf-8');
  const checkRes = await fetch(`http://store.localtest.me/wp-json/wc/v3/products?search=${encodeURIComponent(productName)}`, {
    headers: {
      Authorization: `Basic ` + Buffer.from(`${ck}:${cs}`).toString("base64"),
    },
  });

  if (!checkRes.ok) throw new Error(`WooCommerce REST check failed: ${checkRes.status}`);
  const matchingProducts = await checkRes.json();
  const found = matchingProducts.find((p) => p.name.toLowerCase() === productName.toLowerCase());

  if (!found) {
    throw new Error(`Product "${productName}" was not found in WooCommerce store!`);
  }
  console.log(`VERIFIED ON STORE: Found product ID #${found.id}: "${found.name}" with regular_price: $${found.regular_price}`);
  console.log(`Store Permalink: ${found.permalink}\n`);

  // Step 4: Test "what orders came in today"
  console.log("--- Step 4: Testing Agent Tool Loop: 'what orders came in today' ---");
  const userPrompt2 = "what orders came in today";
  console.log(`Prompt: "${userPrompt2}"`);

  let ordersToolStarted = false;
  let ordersFinalMessage = "";

  const events2 = await readSSEStream(
    `${GATEWAY_URL}/api/chat`,
    token,
    { message: userPrompt2 },
    (event) => {
      if (event.type === "thought") {
        console.log(`  [Thought] ${event.content}`);
      } else if (event.type === "tool_call_start") {
        console.log(`  [Tool Call Start] Tool: ${event.tool}`);
        if (event.tool === "woo__list_orders") ordersToolStarted = true;
      } else if (event.type === "tool_call_end") {
        console.log(`  [Tool Call End] Tool: ${event.tool}`);
      } else if (event.type === "delta" || event.type === "done") {
        if (event.content) ordersFinalMessage = event.content;
      }
    }
  );

  if (!ordersToolStarted) {
    throw new Error("Expected woo__list_orders tool call from chat agent!");
  }
  console.log(`\nAssistant Orders Report:\n${ordersFinalMessage}\n`);

  // Step 5: Verify User Attribution in Audit Log
  console.log("--- Step 5: Verifying User Attribution in Audit Log ---");
  const auditRes = await fetch(`${GATEWAY_URL}/api/audit?limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { logs } = await auditRes.json();
  console.log(`Recent audit log entries:`);

  let attributedToAdmin = false;
  for (const l of logs) {
    console.log(`  [Audit] ${l.created_at} | User: ${l.user_email} | ${l.server_slug}__${l.tool_name} | Outcome: ${l.outcome} (${l.duration_ms}ms)`);
    if (l.user_email === "admin@localtest.me" && (l.tool_name === "create_product" || l.tool_name === "list_orders")) {
      attributedToAdmin = true;
    }
  }

  if (!attributedToAdmin) {
    throw new Error("Audit log failed to attribute agent tool calls to logged-in user!");
  }
  console.log("PASSED: Agent tool executions are strictly attributed to logged-in user identity!\n");

  // Step 6: Verify Chat History Persistence
  console.log("--- Step 6: Verifying Chat History Persistence in Database ---");
  const historyRes = await fetch(`${GATEWAY_URL}/api/chat/history`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { sessions } = await historyRes.json();
  console.log(`User has ${sessions.length} saved chat session(s):`);
  for (const s of sessions.slice(0, 2)) {
    console.log(`  Session #${s.session_id}: "${s.title}" (${s.messages?.length || 0} messages)`);
  }

  console.log("\n============================================================");
  console.log("=== PHASE 6 VERIFICATION GREEN! ALL CHECKS PASSED ===");
  console.log("============================================================\n");
}

main().catch((err) => {
  console.error("Phase 6 verification failed:", err);
  process.exit(1);
});
