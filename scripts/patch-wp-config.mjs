import { execSync } from "child_process";
import fs from "fs";

const podName = execSync('kubectl get pod -l app.kubernetes.io/name=woocommerce -n uai -o jsonpath="{.items[0].metadata.name}"', { encoding: "utf-8" }).trim();

const current = execSync(`kubectl exec -n uai ${podName} -- cat /var/www/html/wp-config.php`, { encoding: "utf-8" });

if (!current.includes("/wp-json")) {
  const patch = `\n// Enable SSL flag for REST API requests so WooCommerce allows Basic Authentication over internal cluster HTTP\nif (isset($_SERVER['REQUEST_URI']) && strpos($_SERVER['REQUEST_URI'], '/wp-json') !== false) {\n    $_SERVER['HTTPS'] = 'on';\n}\n\n`;
  const updated = current.replace("require_once ABSPATH . 'wp-settings.php';", patch + "require_once ABSPATH . 'wp-settings.php';");
  
  fs.writeFileSync("scripts/wp-config.tmp.php", updated, "utf-8");
  execSync(`kubectl cp scripts/wp-config.tmp.php uai/${podName}:/var/www/html/wp-config.php`);
  fs.unlinkSync("scripts/wp-config.tmp.php");
  console.log("Patched wp-config.php successfully in pod", podName);
} else {
  console.log("Already patched in pod", podName);
}
