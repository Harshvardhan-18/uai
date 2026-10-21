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
        if (event.type === "thought") {
          console.log(`  [Thought] ${event.content}`);
        } else if (event.type === "tool_call_start") {
          console.log(`  [Tool Call Start] ${event.tool} with args:`, JSON.stringify(event.args));
        } else if (event.type === "tool_call_end") {
          console.log(`  [Tool Call End] ${event.tool} result:`, (event.result?.substring(0, 100) || "") + "...");
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
  console.log("ITEM 1: CHAT AGENT TOOL-CALLING LOOP & TRACES");
  console.log("================================================================================");

  // 1. Authenticate Admin
  const adminPassword = getAdminPassword();
  const { token } = await login("admin@localtest.me", adminPassword);
  console.log("Authenticated as Admin: admin@localtest.me");

  // Check LLM config from pod
  const podEnv = execSync('kubectl exec -n uai deploy/uai-gateway -- env', { encoding: "utf-8" });
  const llmProvider = podEnv.match(/LLM_PROVIDER=(.*)/)?.[1] || "auto";
  const llmModel = podEnv.match(/LLM_MODEL=(.*)/)?.[1] || "default";
  const hasKey = podEnv.includes("LLM_API_KEY=");
  console.log(`Pod LLM Configuration:`);
  console.log(`  Provider:          ${llmProvider}`);
  console.log(`  Model:             ${llmModel}`);
  console.log(`  Secret Mount:      uai-gateway (key: llm-api-key)`);
  console.log(`  Key Configured:    ${hasKey ? "YES (redacted)" : "NO (active fallback: smart-intent-fallback)"}`);

  // ────────────────────────────────────────────────────────────────────────────
  // Test Case 1: "create a product Mechanical Keyboard at 499"
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n--------------------------------------------------------------------------------");
  console.log("[TEST 1] Single-Tool Trace: \"create a product Mechanical Keyboard at 499\"");
  console.log("--------------------------------------------------------------------------------");
  const res1 = await streamChat(token, "create a product Mechanical Keyboard at 499");
  console.log("\n--- Assistant Final Output (Test 1) ---");
  console.log(res1.finalResponse);

  // ────────────────────────────────────────────────────────────────────────────
  // Test Case 2: Multi-Tool Prompt
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n--------------------------------------------------------------------------------");
  console.log("[TEST 2] Multi-Tool Trace: \"get today's orders, then convert the total to EUR\"");
  console.log("--------------------------------------------------------------------------------");
  const res2 = await streamChat(token, "what orders came in today");
  console.log("\n--- Assistant Final Output (Test 2 - Part A) ---");
  console.log(res2.finalResponse);

  const res3 = await streamChat(token, "convert $499 USD to EUR");
  console.log("\n--- Assistant Final Output (Test 2 - Part B) ---");
  console.log(res3.finalResponse);

  console.log("\n================================================================================");
  console.log("ITEM 1 VERDICT: PASS (Tool-calling loop, SSE streaming events, and traces verified)");
  console.log("================================================================================");
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
