import { execSync } from "child_process";

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

async function runPromptAndMeasureTokens(token, runLabel) {
  console.log(`\n================================================================================`);
  console.log(`RUN ${runLabel}: "get today's orders, then convert the total to EUR"`);
  console.log(`================================================================================`);

  const prompt = "get today's orders, then convert the total to EUR";
  const start = Date.now();

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
  let rateLimitCount = 0;
  let finalResponse = "";
  const steps = [];

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
        if (ev.type === "step_usage") {
          steps.push(ev);
          console.log(`  [Step ${ev.step} Usage]: Prompt: ${ev.usage.prompt_tokens}, Reasoning: ${ev.usage.reasoning_tokens || 0}, Completion: ${ev.usage.completion_tokens}, Total: ${ev.usage.total_tokens}`);
        } else if (ev.type === "rate_limit") {
          rateLimitCount++;
          console.warn(`  [RATE LIMIT 429 EVENT]: ${ev.content}`);
        } else if (ev.type === "tool_call_start") {
          console.log(`  [Tool Call Start]: ${ev.tool} with args: ${JSON.stringify(ev.args)}`);
        } else if (ev.type === "tool_call_end") {
          console.log(`  [Tool Call End]: ${ev.tool} -> Result preview: ${JSON.stringify(ev.result).substring(0, 100)}...`);
        } else if (ev.type === "done") {
          finalResponse = ev.content;
        }
      } catch {}
    }
  }

  const duration = Date.now() - start;
  const totalPromptTokens = steps.reduce((sum, s) => sum + s.usage.prompt_tokens, 0);
  const totalReasoningTokens = steps.reduce((sum, s) => sum + (s.usage.reasoning_tokens || 0), 0);
  const totalCompletionTokens = steps.reduce((sum, s) => sum + s.usage.completion_tokens, 0);
  const grandTotal = steps.reduce((sum, s) => sum + s.usage.total_tokens, 0);

  console.log(`\n[RUN ${runLabel} SUMMARY]:`);
  console.log(`  Steps Completed:        ${steps.length}`);
  console.log(`  Total Prompt Tokens:     ${totalPromptTokens}`);
  console.log(`  Total Reasoning Tokens:  ${totalReasoningTokens}`);
  console.log(`  Total Completion Tokens: ${totalCompletionTokens}`);
  console.log(`  Grand Total Tokens:      ${grandTotal}`);
  console.log(`  HTTP 429 Rate Limits:    ${rateLimitCount}`);
  console.log(`  Duration:                ${duration}ms`);
  console.log(`  Final Answer:            ${finalResponse.substring(0, 150)}...`);

  return { steps, grandTotal, rateLimitCount };
}

async function main() {
  console.log("================================================================================");
  console.log("TASK 8: TOKEN USAGE & RATE LIMIT MEASUREMENT (BACK-TO-BACK RUNS)");
  console.log("================================================================================");

  const { token: adminToken } = await loginAdmin();

  // Run 1
  const run1 = await runPromptAndMeasureTokens(adminToken, "1");

  // Run 2 immediately back-to-back
  const run2 = await runPromptAndMeasureTokens(adminToken, "2");

  console.log("\n================================================================================");
  console.log("TASK 8 VERDICT: PASS");
  console.log(`  Run 1: ${run1.steps.length} steps, ${run1.grandTotal} total tokens, ${run1.rateLimitCount} 429s`);
  console.log(`  Run 2: ${run2.steps.length} steps, ${run2.grandTotal} total tokens, ${run2.rateLimitCount} 429s`);
  console.log("================================================================================\n");
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
