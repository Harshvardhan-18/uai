import { execSync } from "child_process";

const secrets = JSON.parse(execSync("kubectl get secrets -n uai -o json", { encoding: "utf-8" }));
console.log("NAME".padEnd(25) + "KEY".padEnd(25) + "DECODED LENGTH");
console.log("-".repeat(65));
for (const s of secrets.items) {
  if (s.type === "kubernetes.io/service-account-token") continue;
  const sName = s.metadata.name;
  for (const [k, b64] of Object.entries(s.data || {})) {
    const len = Buffer.from(b64, "base64").length;
    console.log(sName.padEnd(25) + k.padEnd(25) + len + " bytes");
  }
}
