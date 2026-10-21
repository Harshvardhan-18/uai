import { URL } from "url";
import dns from "dns";
import { config } from "../config.js";

/**
 * Check if a URL matches the strict in-cluster host:port allowlist
 */
function isAllowedInCluster(parsed: URL): boolean {
  const hostname = parsed.hostname.toLowerCase();
  const effectivePort = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  const hostPort = `${hostname}:${effectivePort}`;

  const allowedEntries = config.inClusterAllowlist
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return allowedEntries.includes(hostPort);
}

/**
 * Map low-level transport errors to specific root cause messages
 */
export function mapTransportError(err: any): string {
  if (!err) return "Unknown error";
  const msg = (err.message || "").toLowerCase();
  const causeMsg = (err.cause?.message || "").toLowerCase();
  const code = (err.code || err.cause?.code || "").toLowerCase();

  if (err.name === "AbortError" || msg.includes("aborted") || msg.includes("timed out") || code === "etimedout") {
    return "Connection timed out (upstream exceeded timeout threshold)";
  }
  if (code === "econnrefused" || msg.includes("econnrefused") || causeMsg.includes("econnrefused")) {
    return "Connection refused (upstream pod down or port not listening)";
  }
  if (code === "enotfound" || code === "eai_again" || msg.includes("enotfound") || causeMsg.includes("enotfound")) {
    return "DNS resolution failed (host does not exist)";
  }
  if (msg.includes("certificate") || msg.includes("tls") || msg.includes("ssl") || code.includes("cert")) {
    return "TLS/SSL certificate validation failed";
  }
  if (msg.includes("ssrf blocked") || msg.includes("ssrf validation failed")) {
    return err.message;
  }
  if (msg.includes("redirect") || causeMsg.includes("redirect") || msg.includes("maximum redirects")) {
    return "HTTP redirect blocked (redirects not permitted on upstream connections)";
  }
  return err.message || "Connection failed";
}

/**
 * SSRF Guard: Validates upstream URLs against Server-Side Request Forgery attacks.
 * Blocks cloud metadata IPs, loopback, link-local, dangerous schemes,
 * and performs asynchronous DNS resolution to block DNS-based bypasses (e.g. *.nip.io).
 */
export async function validateUpstreamUrl(urlString: string): Promise<{ valid: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, reason: "Malformed URL format." };
  }

  // 1. Enforce safe protocol
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, reason: `Forbidden protocol '${parsed.protocol}'. Only http: and https: are allowed.` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. Block Cloud Metadata Hostnames
  const cloudMetadataHosts = [
    "169.254.169.254",
    "metadata.google.internal",
    "metadata.goog",
    "100.100.100.200",
    "instance-data",
  ];
  if (cloudMetadataHosts.includes(hostname)) {
    return { valid: false, reason: `Forbidden destination: Access to cloud metadata service (${hostname}) is blocked.` };
  }

  // 3. Block Loopback Hostnames & IP strings directly
  const loopbackHosts = ["127.0.0.1", "localhost", "0.0.0.0", "::1", "0"];
  if (loopbackHosts.includes(hostname)) {
    return { valid: false, reason: "Forbidden destination: Loopback address is blocked." };
  }

  // 4. Block Link-Local IPv4 range (169.254.0.0/16)
  if (hostname.startsWith("169.254.")) {
    return { valid: false, reason: "Forbidden destination: Link-local 169.254.x.x range is blocked." };
  }

  // 5. Block direct Kubernetes control plane access
  if (
    hostname === "kubernetes" ||
    hostname === "kubernetes.default" ||
    hostname === "kubernetes.default.svc" ||
    hostname === "kubernetes.default.svc.cluster.local"
  ) {
    return { valid: false, reason: "Forbidden destination: Direct access to Kubernetes API is blocked." };
  }

  // 6. Check strict in-cluster host:port allowlist
  if (isAllowedInCluster(parsed)) {
    return { valid: true };
  }

  // 7. Asynchronous DNS Resolution & Verification across all resolved addresses
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    for (const addr of addresses) {
      const ip = addr.address;

      // Loopback check (127.0.0.0/8, ::1, 0.0.0.0)
      if (ip.startsWith("127.") || ip === "::1" || ip === "0.0.0.0" || ip === "::") {
        return { valid: false, reason: `Forbidden destination: Hostname resolves to loopback IP (${ip}).` };
      }

      // Link-local check (169.254.0.0/16, fe80::/10)
      if (ip.startsWith("169.254.") || ip.toLowerCase().startsWith("fe80:")) {
        return { valid: false, reason: `Forbidden destination: Hostname resolves to link-local IP (${ip}).` };
      }

      // Cloud metadata IP check
      if (ip === "169.254.169.254" || ip === "100.100.100.200") {
        return { valid: false, reason: `Forbidden destination: Hostname resolves to cloud metadata IP (${ip}).` };
      }

      // Private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) if not allowlisted
      if (ip.startsWith("10.") || ip.startsWith("192.168.") || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) {
        return { valid: false, reason: `Forbidden destination: Hostname resolves to private IP (${ip}) not in allowlist.` };
      }
    }
  } catch (err: any) {
    return { valid: false, reason: `DNS resolution failed for host '${hostname}': ${err.message}` };
  }

  return { valid: true };
}
