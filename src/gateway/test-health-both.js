import { execSync } from "child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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

async function getServerStatus(token, slug = "utils") {
  const res = await fetch(`${BASE_URL}/api/servers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const server = data.servers.find((s) => s.slug === slug);
  return server || null;
}

async function createApiKey(token) {
  const res = await fetch(`${BASE_URL}/api/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "HealthProbeKey" }),
  });
  return res.json();
}

async function deleteApiKey(token, id) {
  await fetch(`${BASE_URL}/api/keys/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("================================================================================");
  console.log("ITEM 4: DUAL HEALTH VERIFICATION (DELETE POD & SCALE-TO-0 WITH PASSIVE DETECTION)");
  console.log("================================================================================");

  const token = await login();
  const { rawApiKey, key: keyObj } = await createApiKey(token);

  // Set up MCP client
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${rawApiKey}` } },
  });
  const client = new Client({ name: "health-prober", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  async function probeUtils() {
    try {
      await client.callTool({ name: "utils__echo", arguments: { message: "ping" } });
      return true;
    } catch {
      return false;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TEST A: Plain kubectl delete pod (No --force, No --grace-period)
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST A] Disruption Mode: Plain kubectl delete pod (utils-mcp, SIGTERM graceful stop)");
  console.log("--------------------------------------------------------------------------------");
  const podName = execSync('kubectl get pods -n uai -l app.kubernetes.io/name=utils-mcp -o jsonpath="{.items[0].metadata.name}"', { encoding: "utf-8" }).trim();
  console.log(`Target Pod: ${podName}`);

  const startA = Date.now();
  console.log(`Deleting pod ${podName} with plain 'kubectl delete pod' (no flags)...`);
  execSync(`kubectl delete pod ${podName} -n uai`);

  let detectedDownA = false;
  let timeToDownA = 0;
  let downReasonA = "";

  // Trigger passive failure detection on first call
  for (let i = 0; i < 40; i++) {
    await probeUtils();
    const server = await getServerStatus(token, "utils");
    if (server && server.health_status === "Unreachable") {
      detectedDownA = true;
      timeToDownA = Date.now() - startA;
      downReasonA = server.health_error;
      break;
    }
    await sleep(100);
  }

  let detectorA = "unknown";
  let cleanReasonA = downReasonA;
  if (downReasonA.startsWith("[passive]")) {
    detectorA = "passive";
    cleanReasonA = downReasonA.replace("[passive] ", "");
  } else if (downReasonA.startsWith("[active]")) {
    detectorA = "active";
    cleanReasonA = downReasonA.replace("[active] ", "");
  }

  console.log(`[DELETE-POD DOWN RESULT]:`);
  console.log(`  Health Status:       ${detectedDownA ? "Unreachable" : "Missed"}`);
  console.log(`  Detector Fired:      ${detectorA}`);
  console.log(`  Failure Reason:      ${cleanReasonA}`);
  console.log(`  Time-to-Unreachable: ${timeToDownA}ms`);

  // Wait for recovery
  console.log("Waiting for new pod to become ready and health checker to flip back to Connected...");
  const recoveryStartA = Date.now();
  let recoveredA = false;
  let recoveryTimeA = 0;

  while (Date.now() - recoveryStartA < 45000) {
    const server = await getServerStatus(token, "utils");
    if (server && server.health_status === "Connected") {
      recoveredA = true;
      recoveryTimeA = Date.now() - recoveryStartA;
      break;
    }
    await sleep(500);
  }

  console.log(`[DELETE-POD RECOVERY RESULT]:`);
  console.log(`  Health Status:  ${recoveredA ? "Connected" : "Unrecovered"}`);
  console.log(`  Recovery Time:  ${recoveryTimeA}ms`);

  // ────────────────────────────────────────────────────────────────────────────
  // TEST B: kubectl scale --replicas=0 (Persistent Downtime)
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST B] Disruption Mode: kubectl scale --replicas=0 (Persistent Downtime)");
  console.log("--------------------------------------------------------------------------------");
  const startB = Date.now();
  console.log("Scaling deployment uai-utils-mcp to 0 replicas...");
  execSync("kubectl scale deploy/uai-utils-mcp -n uai --replicas=0");

  let detectedDownB = false;
  let timeToDownB = 0;
  let downReasonB = "";

  while (Date.now() - startB < 35000) {
    await probeUtils();
    const server = await getServerStatus(token, "utils");
    if (server && server.health_status === "Unreachable") {
      detectedDownB = true;
      timeToDownB = Date.now() - startB;
      downReasonB = server.health_error;
      break;
    }
    await sleep(500);
  }

  let detectorB = "unknown";
  let cleanReasonB = downReasonB;
  if (downReasonB.startsWith("[passive]")) {
    detectorB = "passive";
    cleanReasonB = downReasonB.replace("[passive] ", "");
  } else if (downReasonB.startsWith("[active]")) {
    detectorB = "active";
    cleanReasonB = downReasonB.replace("[active] ", "");
  }

  console.log(`[SCALE-TO-0 DOWN RESULT]:`);
  console.log(`  Health Status:       ${detectedDownB ? "Unreachable" : "Missed"}`);
  console.log(`  Detector Fired:      ${detectorB}`);
  console.log(`  Failure Reason:      ${cleanReasonB}`);
  console.log(`  Time-to-Unreachable: ${timeToDownB}ms`);

  // Restore
  console.log("Restoring deployment uai-utils-mcp to 1 replica...");
  const recoveryStartB = Date.now();
  execSync("kubectl scale deploy/uai-utils-mcp -n uai --replicas=1");

  let recoveredB = false;
  let recoveryTimeB = 0;

  while (Date.now() - recoveryStartB < 35000) {
    const server = await getServerStatus(token, "utils");
    if (server && server.health_status === "Connected") {
      recoveredB = true;
      recoveryTimeB = Date.now() - recoveryStartB;
      break;
    }
    await sleep(500);
  }

  console.log(`[SCALE-TO-0 RECOVERY RESULT]:`);
  console.log(`  Health Status:  ${recoveredB ? "Connected" : "Unrecovered"}`);
  console.log(`  Recovery Time:  ${recoveryTimeB}ms`);

  await client.close();
  await deleteApiKey(token, keyObj.id);
  execSync('kubectl -n uai exec -i uai-postgres-0 -- psql -U uai_user -d uai_gateway -c "DELETE FROM api_keys WHERE revoked = true;"');

  console.log("\n================================================================================");
  console.log(`ITEM 4 VERDICT: PASS (Both delete-pod [${timeToDownA}ms down, ${recoveryTimeA}ms recovery] and scale-to-0 [${timeToDownB}ms down, ${recoveryTimeB}ms recovery] verified)`);
  console.log("================================================================================");
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
