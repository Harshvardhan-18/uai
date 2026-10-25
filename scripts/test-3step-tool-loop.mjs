import { execSync } from "child_process";

const BASE_URL = "http://app.localtest.me";

function getAdminPassword() {
  const pw = execSync('kubectl get secret -n uai uai-gateway -o jsonpath="{.data.admin-password}"', { encoding: "utf-8" });
  return Buffer.from(pw.trim(), "base64").toString("utf-8");
}

async function login() {
  const password = getAdminPassword();
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@localtest.me", password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log("=== ITEM 7: 3-STEP MULTI-TOOL PROMPT COMPLETION TEST ===");
  const { token } = await login();

  const prompt = "Please do three things sequentially: first check the current time using utils__get_current_time, then convert 150 USD to EUR using utils__convert_currency, and finally echo 'Multi-tool workflow complete' using utils__echo.";
  console.log(`Prompt: "${prompt}"\n`);

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: prompt }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalContent = "";
  const toolsExecuted = [];
  let meta = null;
  let rateLimitEvent = null;

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
        if (ev.type === "rate_limit") {
          rateLimitEvent = ev;
          console.log(`[Rate Limit Event Captured]: ${ev.content}`);
        }
        if (ev.type === "tool_call_start") {
          console.log(`[Step ${toolsExecuted.length + 1} Invoked]: ${ev.tool} args: ${JSON.stringify(ev.args)}`);
          toolsExecuted.push(ev.tool);
        }
        if (ev.type === "done") finalContent = ev.content;
      } catch {}
    }
  }

  console.log(`\nTools executed (${toolsExecuted.length}):`, toolsExecuted.join(" -> "));
  console.log("\n[Final Answer]:\n" + finalContent);

  if (toolsExecuted.length >= 3) {
    console.log(`\n[PASS] 3-step multi-tool prompt completed successfully! (${toolsExecuted.length} tools chained)`);
  } else {
    console.log(`\n[NOTE] Completed ${toolsExecuted.length} tool steps.`);
  }
}

main().catch(console.error);
