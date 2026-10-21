import { execSync } from "child_process";

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

async function runPrompt(token, promptTitle, message) {
  console.log(`\n================================================================================`);
  console.log(`PROMPT: "${message}" (${promptTitle})`);
  console.log(`================================================================================`);

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) throw new Error(`Chat error (${res.status}): ${await res.text()}`);

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
        const ev = JSON.parse(jsonStr);
        events.push(ev);
        if (ev.type === "meta") {
          console.log(`[META EVENT] Provider: ${ev.provider} | Model: ${ev.model} | isFallback: ${ev.isFallback}`);
        } else if (ev.type === "thought") {
          console.log(`[THOUGHT] ${ev.content}`);
        } else if (ev.type === "tool_call_start") {
          console.log(`[TOOL CALL START] Tool: ${ev.tool}`);
          console.log(`  Args:`, JSON.stringify(ev.args, null, 2));
        } else if (ev.type === "tool_call_end") {
          console.log(`[TOOL CALL END] Tool: ${ev.tool} | isError: ${ev.isError || false}`);
          const preview = typeof ev.result === "string" ? ev.result.substring(0, 150) : JSON.stringify(ev.result).substring(0, 150);
          console.log(`  Result preview: ${preview}...`);
        } else if (ev.type === "done") {
          console.log(`\n[FINAL ASSISTANT ANSWER]`);
          console.log(ev.content);
        }
      } catch (e) {}
    }
  }

  return events;
}

async function main() {
  const adminPassword = getAdminPassword();
  const { token } = await login("admin@localtest.me", adminPassword);
  console.log("Logged in as admin@localtest.me");

  // 1. Single tool prompt: create a product
  await runPrompt(token, "Case 2a: Single Tool Call", "create a product Mechanical Keyboard Pro at 499");

  // 2. Sequential multi-tool prompt: get today's orders then convert total to EUR
  await runPrompt(token, "Case 2b: Multi-Tool Chained Call", "get today's orders, then convert the total to EUR");

  // 3. Date filtering prompt: what orders came in today
  await runPrompt(token, "Case 2c: Model-Chosen ISO Date Arguments", "what orders came in today");
}

main().catch(console.error);
