import { URL } from "url";

/**
 * SSRF Guard: Validates upstream URLs against Server-Side Request Forgery attacks.
 * Blocks cloud metadata IPs, loopback, link-local, and dangerous schemes.
 */
export function validateUpstreamUrl(urlString: string): { valid: boolean; reason?: string } {
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

  // 2. Block Cloud Metadata Services
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

  // 3. Block Loopback
  const loopbackHosts = ["127.0.0.1", "localhost", "0.0.0.0", "::1", "0"];
  if (loopbackHosts.includes(hostname)) {
    return { valid: false, reason: "Forbidden destination: Loopback address is blocked." };
  }

  // 4. Block Link-Local IPv4 range (169.254.0.0/16)
  if (hostname.startsWith("169.254.")) {
    return { valid: false, reason: "Forbidden destination: Link-local 169.254.x.x range is blocked." };
  }

  // 5. Block sensitive Kubernetes control plane access
  if (hostname === "kubernetes" || hostname === "kubernetes.default" || hostname === "kubernetes.default.svc") {
    return { valid: false, reason: "Forbidden destination: Direct access to Kubernetes API is blocked." };
  }

  return { valid: true };
}
