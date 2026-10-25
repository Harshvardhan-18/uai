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
  console.log("=== ITEM 2: CHAT PRODUCT CREATION & PERMALINK HTTP 200 PROOF ===");
  const { token } = await login();

  const prodName = "Precision Gaming Mouse " + Math.floor(Math.random() * 1000);
  console.log(`Sending Prompt: "create a product ${prodName} at 349" ...`);

  const chatRes = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: `create a product ${prodName} at 349` }),
  });

  const reader = chatRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalContent = "";
  let toolArgs = null;
  let toolResult = null;
  let metaInfo = null;

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
        if (ev.type === "meta") metaInfo = ev;
        if (ev.type === "tool_call_start" && ev.tool === "woo__create_product") {
          toolArgs = ev.args;
        }
        if (ev.type === "tool_call_end" && ev.tool === "woo__create_product") {
          toolResult = ev.result;
        }
        if (ev.type === "done") finalContent = ev.content;
      } catch {}
    }
  }

  console.log("\n[LLM Metadata]:", JSON.stringify(metaInfo));
  console.log("[Model Tool Call Args]:", JSON.stringify(toolArgs));
  console.log("[Tool Execution Result Preview]:", typeof toolResult === 'string' ? toolResult.substring(0, 200) : JSON.stringify(toolResult));
  console.log("\n[Final Agent Answer]:\n" + finalContent);

  // Extract link
  const linkMatch = finalContent.match(/https?:\/\/[^\s\)]+/);
  if (!linkMatch) {
    console.error("No URL found in response!");
    process.exit(1);
  }

  const url = linkMatch[0];
  console.log(`\nExtracted Product Permalink: ${url}`);

  // Test opening url
  const httpRes = await fetch(url);
  console.log(`HTTP Status from storefront: ${httpRes.status} ${httpRes.statusText}`);
  if (httpRes.status === 200 && url.startsWith("http://")) {
    console.log("[PASS] Product permalink uses 'http://' and returned HTTP 200 OK!");
  } else {
    console.error(`[FAIL] Scheme or status incorrect: ${url} (status: ${httpRes.status})`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
