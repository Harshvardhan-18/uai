import { execSync } from "child_process";
import fs from "fs";

console.log("================================================================================");
console.log("TASK 12: HISTORICAL SECRET-LIKE LITERAL AUDIT (REPLACEMENTS.TXT PREP)");
console.log("================================================================================");

const replacementsPath = "../replacements.txt";
const raw = fs.readFileSync(replacementsPath, "utf-8");
const lines = raw.split("\n").map(l => l.trim()).filter(l => l && l.includes("==>"));

console.log(`Auditing ${lines.length} literals from ${replacementsPath}...`);
console.log("(Secret values redacted; reporting Hit Counts and Commit SHAs only)\n");
console.log("REDACTION LABEL".padEnd(35) + "HITS".padEnd(8) + "COMMIT SHAs");
console.log("-".repeat(80));

for (const line of lines) {
  const [literal, label] = line.split("==>");
  try {
    // Run git log for this literal
    const out = execSync(`git log --all -S"${literal}" --oneline`, { encoding: "utf-8" }).trim();
    const commits = out ? out.split("\n") : [];
    const count = commits.length;
    const shas = commits.map(c => c.split(" ")[0]).join(", ") || "None";
    console.log(label.padEnd(35) + String(count).padEnd(8) + shas);
  } catch (err) {
    console.log(label.padEnd(35) + "0".padEnd(8) + "None");
  }
}

console.log("\n--------------------------------------------------------------------------------");
console.log("STATUS: Prep only. git filter-repo has NOT been run. Awaiting operator approval.");
console.log("================================================================================\n");
