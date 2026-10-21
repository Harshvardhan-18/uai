import { execSync } from "child_process";

const API_BASE = "http://app.localtest.me/api";

function getAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const pw = execSync('kubectl get secret -n uai uai-gateway -o jsonpath="{.data.admin-password}"', { encoding: "utf-8" });
  return Buffer.from(pw.trim(), "base64").toString("utf-8");
}

async function main() {
  const adminPassword = getAdminPassword();
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@localtest.me", password: adminPassword }),
  });
  if (!loginRes.ok) throw new Error("Admin login failed");
  const { token } = await loginRes.json();

  console.log("================================================================================");
  console.log("ITEM 3: UNREACHABLE STATE & BOUNDED DETECTION VERIFICATION");
  console.log("================================================================================");
  console.log("[1] Scaling down uai-utils-mcp deployment to 0 replicas...");
  const t0 = Date.now();
  execSync("kubectl scale deployment -n uai uai-utils-mcp --replicas=0");

  let flipped = false;
  let status = "";
  let reason = "";
  let timeToDetect = 0;

  // Poll check-health until status flips to Unreachable (bounded to 45s due to k8s pod termination grace period)
  while (Date.now() - t0 < 45000) {
    const res = await fetch(`${API_BASE}/servers/check-health`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`check-health failed: ${res.status}`);
    const data = await res.json();
    const utils = data.servers.find((s) => s.slug === "utils");
    if (utils && utils.health_status === "Unreachable") {
      flipped = true;
      status = utils.health_status;
      reason = utils.health_error;
      timeToDetect = Date.now() - t0;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!flipped) {
    throw new Error("FAIL: Server status did not flip to Unreachable within 45s threshold!");
  }

  console.log(`\n[DOWN STATE DETECTED] in ${timeToDetect}ms:`);
  console.log(`  Server:        Utility Tools`);
  console.log(`  Health Status: ${status}`);
  console.log(`  Failure Reason: ${reason}`);
  console.log(`  Time-to-Detect: ${timeToDetect}ms (bounded by health-check timeout + k8s termination)`);

  if (!reason.includes("Connection refused") && !reason.includes("connect")) {
    throw new Error(`FAIL: Unexpected failure reason: ${reason}`);
  }

  console.log("\n[2] Restoring uai-utils-mcp to 1 replica...");
  execSync("kubectl scale deployment -n uai uai-utils-mcp --replicas=1");
  execSync("kubectl rollout status deployment -n uai uai-utils-mcp --timeout=60s");

  let recovered = false;
  let recStatus = "";
  let recReason = "";
  const tRec = Date.now();

  while (Date.now() - tRec < 20000) {
    const recRes = await fetch(`${API_BASE}/servers/check-health`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const recData = await recRes.json();
    const utilsRec = recData.servers.find((s) => s.slug === "utils");
    if (utilsRec && utilsRec.health_status === "Connected") {
      recovered = true;
      recStatus = utilsRec.health_status;
      recReason = utilsRec.health_error;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log("\n[RECOVERED STATE]:");
  console.log(`  Health Status: ${recStatus}`);
  console.log(`  Failure Reason: ${recReason || "none (healthy)"}`);

  if (!recovered) {
    throw new Error(`FAIL: Server did not recover to Connected state! Got: ${recStatus}`);
  }

  console.log("\n================================================================================");
  console.log("ITEM 3 VERDICT: PASS (Status flipped to Unreachable with specific reason and recovered cleanly)");
  console.log("================================================================================");
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
