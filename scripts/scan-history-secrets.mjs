import { execSync } from "child_process";

const patterns = [
  "gsk_",
  "gw_",
  "ck_",
  "cs_",
  "password",
  "secret",
  "token",
  "key",
];

console.log("=== ITEM 12: GIT HISTORY & TRACKED REPO SECRET AUDIT ===");
console.log("PATTERN".padEnd(12) + "COMMIT HIT COUNT".padEnd(20) + "SAMPLE COMMITS");
console.log("-".repeat(60));

for (const p of patterns) {
  try {
    const out = execSync(`git log --all -S "${p}" --oneline`, { encoding: "utf-8" }).trim();
    const commits = out ? out.split("\n") : [];
    const shas = commits.slice(0, 3).map(c => c.split(" ")[0]).join(", ");
    console.log(p.padEnd(12) + String(commits.length).padEnd(20) + shas);
  } catch (err) {
    console.log(p.padEnd(12) + "0".padEnd(20) + "None");
  }
}

console.log("\n--- Checking for Real Hardcoded Secret Tokens in Git History ---");
// Check specifically if any real api keys/tokens ever appeared in commit diffs
const specificPatterns = [
  { label: "Groq API Key (gsk_...)", regex: "gsk_[A-Za-z0-9_]{30,}" },
  { label: "Gateway Token (gw_...)", regex: "gw_[A-Za-z0-9_]{20,}" },
  { label: "Woo Consumer Key (ck_...)", regex: "ck_[0-9a-f]{32,}" },
  { label: "Woo Consumer Secret (cs_...)", regex: "cs_[0-9a-f]{32,}" },
];

for (const sp of specificPatterns) {
  try {
    const out = execSync(`git log --all -G "${sp.regex}" --oneline`, { encoding: "utf-8" }).trim();
    const commits = out ? out.split("\n") : [];
    console.log(`${sp.label.padEnd(35)}: ${commits.length} commit(s) found ${commits.length > 0 ? "(" + commits.map(c => c.split(" ")[0]).join(", ") + ")" : ""}`);
  } catch (err) {
    console.log(`${sp.label.padEnd(35)}: 0 commits`);
  }
}

console.log("\nNote: No filter-repo executed. Candidates and hit counts reported only.");
