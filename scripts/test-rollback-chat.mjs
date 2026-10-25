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
  const { token } = await login();
  console.log("Sending chat message: 'echo Hello from test' ...");

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: "echo Hello from test" }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let meta = null;
  let content = "";
  let buffer = "";

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
        if (ev.type === "done") content = ev.content;
      } catch {}
    }
  }

  console.log("Chat Response Meta:", JSON.stringify(meta));
  console.log("Chat Response Preview:", content.substring(0, 150));
}

main().catch(console.error);
