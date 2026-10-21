import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const raw = readFileSync("../replacements.txt", "utf-8");
const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

console.log("PATTERN".padEnd(12) + "COMMITS".padEnd(10) + "COMMIT SHAs");
console.log("-".repeat(60));

const validLines = [];
let i = 1;
for (const line of lines) {
  const [literal, replacement] = line.split("==>");
  if (!literal) continue;
  try {
    const cmd = `git log --all -S"${literal}" --oneline`;
    const out = execSync(cmd, { encoding: "utf-8" }).trim();
    const hits = out ? out.split("\n") : [];
    const shas = hits.map((h) => h.split(" ")[0]).join(", ");
    console.log(`Pattern ${i}`.padEnd(12) + String(hits.length).padEnd(10) + (shas || "0"));
    if (hits.length > 0) {
      validLines.push(line);
    }
  } catch (e) {
    console.log(`Pattern ${i}`.padEnd(12) + "0".padEnd(10) + "Error");
  }
  i++;
}

writeFileSync("../replacements.txt", validLines.join("\n") + "\n");
console.log(`\nUpdated ../replacements.txt: Retained ${validLines.length} active patterns (0-hit removed).`);
