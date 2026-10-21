import { execSync } from "child_process";

async function run() {
  console.log("=== CHECKING OLD PASSWORDS ===");
  const adminOld = await fetch("http://app.localtest.me/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@localtest.me", password: "REDACTED_ADMIN_PASS" }),
  });
  console.log("Admin with OLD password 'REDACTED_ADMIN_PASS':", adminOld.status, await adminOld.text());

  const memberOld = await fetch("http://app.localtest.me/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "member@localtest.me", password: "REDACTED_MEMBER_PASS" }),
  });
  console.log("Member with OLD password 'REDACTED_MEMBER_PASS':", memberOld.status, await memberOld.text());

  console.log("\n=== CHECKING NEW ADMIN PASSWORD FROM K8S SECRET ===");
  const pwB64 = execSync('kubectl get secret -n uai uai-gateway -o jsonpath="{.data.admin-password}"', { encoding: "utf-8" }).trim();
  const adminPass = Buffer.from(pwB64, "base64").toString("utf-8");
  console.log("Retrieved admin-password from secret. Length:", adminPass.length);

  const adminNew = await fetch("http://app.localtest.me/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@localtest.me", password: adminPass }),
  });
  console.log("Admin with NEW generated password status:", adminNew.status);
  const adminData = await adminNew.json();
  console.log("Logged in user:", adminData.user?.email, "| Role:", adminData.user?.role, "| Token length:", adminData.token?.length);
}

run().catch(console.error);
