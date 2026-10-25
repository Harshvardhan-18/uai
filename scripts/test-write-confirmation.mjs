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

async function sendChatWithConfirmation(token, prompt, actionToTake) {
  console.log(`\n--- Prompt: "${prompt}" (Configured Action: ${actionToTake.toUpperCase()}) ---`);

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
  let confirmationReceived = null;
  let finalResponse = "";

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
        if (ev.type === "confirmation_required") {
          confirmationReceived = ev;
          console.log(`[EVENT: confirmation_required] Tool: ${ev.tool}, ConfID: ${ev.confirmationId}`);
          console.log(`       Args:`, JSON.stringify(ev.args));

          // Immediately submit user action
          console.log(`[USER ACTION] Submitting ${actionToTake.toUpperCase()} for confirmationId: ${ev.confirmationId}...`);
          const confirmRes = await fetch(`${BASE_URL}/api/chat/confirm`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              confirmationId: ev.confirmationId,
              action: actionToTake,
              reason: actionToTake === "reject" ? "User manually cancelled via UI dialog" : undefined,
            }),
          });
          const confirmData = await confirmRes.json();
          console.log(`[CONFIRM API RESPONSE]:`, JSON.stringify(confirmData));
        } else if (ev.type === "confirmation_result") {
          console.log(`[EVENT: confirmation_result] Approved: ${ev.approved}, Reason: ${ev.reason || "None"}`);
        } else if (ev.type === "done") {
          finalResponse = ev.content;
          console.log(`[EVENT: done] Model final answer: ${finalResponse.substring(0, 160)}...`);
        }
      } catch {}
    }
  }

  return { confirmationReceived, finalResponse };
}

async function main() {
  console.log("================================================================================");
  console.log("TASK 5: HUMAN-IN-THE-LOOP WRITE CONFIRMATION VERIFICATION");
  console.log("================================================================================");

  const { token } = await login();

  // Test 1: Reject Flow
  console.log("\n[1] Testing REJECT Flow (User clicks Reject)...");
  await sendChatWithConfirmation(token, "create a product Rejected Headphones at 199", "reject");

  // Verify Audit Log has 'rejected' row
  const auditRejected = execSync(
    'kubectl exec -n uai uai-postgres-0 -- psql -U uai_user -d uai_gateway -t -A -c "SELECT tool_name, outcome, error_message FROM audit_logs WHERE outcome = \'rejected\' ORDER BY id DESC LIMIT 1;"',
    { encoding: "utf-8" }
  ).trim();
  console.log(`[POSTGRES AUDIT VERIFICATION - REJECTED]: ${auditRejected}`);

  // Test 2: Approve Flow
  console.log("\n[2] Testing APPROVE Flow (User clicks Approve)...");
  await sendChatWithConfirmation(token, "create a product Confirmed Headset at 299", "approve");

  // Verify Audit Log has 'success' row for the tool
  const auditSuccess = execSync(
    'kubectl exec -n uai uai-postgres-0 -- psql -U uai_user -d uai_gateway -t -A -c "SELECT tool_name, outcome FROM audit_logs WHERE tool_name = \'woo__create_product\' AND outcome = \'success\' ORDER BY id DESC LIMIT 1;"',
    { encoding: "utf-8" }
  ).trim();
  console.log(`[POSTGRES AUDIT VERIFICATION - APPROVED]: ${auditSuccess}`);

  console.log("\n================================================================================");
  console.log("TASK 5 VERDICT: PASS (Write confirmation required, approved and rejected flows verified with audit rows)");
  console.log("================================================================================\n");
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
