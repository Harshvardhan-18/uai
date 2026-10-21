import { execSync } from "child_process";

const pwB64 = execSync('kubectl get secret -n uai uai-gateway -o jsonpath="{.data.admin-password}"', { encoding: "utf-8" }).trim();
const adminPassword = Buffer.from(pwB64, "base64").toString("utf-8");

const loginRes = await fetch("http://app.localtest.me/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@localtest.me", password: adminPassword })
});
const { token } = await loginRes.json();

const chatRes = await fetch("http://app.localtest.me/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ message: "create a product Ergonomic Mouse at 499" })
});
const reader = chatRes.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let finalMsg = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value);
  for (const line of buffer.split("\n\n")) {
    if (line.startsWith("data: ")) {
      try {
        const ev = JSON.parse(line.substring(6));
        if (ev.type === "done") finalMsg = ev.content;
      } catch {}
    }
  }
}
console.log("Chat response:\n" + finalMsg);
const urlMatch = finalMsg.match(/\((http[^\)]+)\)/);
if (urlMatch) {
  const url = urlMatch[1];
  console.log("Extracted Store URL:", url);
  const headRes = await fetch(url);
  console.log("HTTP Status of Store URL:", headRes.status);
  if (headRes.status !== 200) {
    throw new Error(`Store URL failed to open! Status: ${headRes.status}`);
  }
  console.log("VERDICT: PASS (Product permalink is valid HTTP and returns 200 OK)");
} else {
  throw new Error("No URL found in response!");
}
