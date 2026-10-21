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
  const { token } = await loginRes.json();

  const res = await fetch(`${API_BASE}/servers/check-health`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  console.log("Health check result:", JSON.stringify(data, null, 2));
}

main().catch(console.error);
