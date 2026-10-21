import { execSync } from "child_process";

const pwB64 = execSync('kubectl get secret -n uai uai-mariadb -o jsonpath="{.data.password}"', { encoding: "utf-8" }).trim();
const pw = Buffer.from(pwB64, "base64").toString("utf-8");

const out = execSync(
  `kubectl exec -i -n uai uai-mariadb-0 -- mariadb -u wp_user -p${pw} -D wordpress -e "SELECT option_name, option_value FROM wp_options WHERE option_name = 'timezone_string' OR option_name = 'gmt_offset';"`,
  { encoding: "utf-8" }
);
console.log(out);
