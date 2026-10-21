const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  throw new Error("FATAL CONFIG ERROR: Required environment variable ADMIN_PASSWORD is not set.");
}

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error("FATAL CONFIG ERROR: Required environment variable JWT_SECRET is not set.");
}

const encryptionKey = process.env.ENCRYPTION_KEY;
if (!encryptionKey) {
  throw new Error("FATAL CONFIG ERROR: Required environment variable ENCRYPTION_KEY is not set.");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("FATAL CONFIG ERROR: Required environment variable DATABASE_URL is not set.");
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  databaseUrl,
  encryptionKey,
  jwtSecret,
  adminEmail: process.env.ADMIN_EMAIL || "admin@localtest.me",
  adminPassword,
  upstreamTimeoutList: parseInt(process.env.UPSTREAM_TIMEOUT_LIST || "5000", 10),
  upstreamTimeoutCall: parseInt(process.env.UPSTREAM_TIMEOUT_CALL || "30000", 10),
  toolCacheTtlMs: parseInt(process.env.TOOL_CACHE_TTL_MS || "30000", 10),
  healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || "10000", 10),
  inClusterAllowlist:
    process.env.IN_CLUSTER_ALLOWLIST ||
    "uai-woo-mcp:8000,uai-woo-mcp.uai.svc.cluster.local:8000,uai-utils-mcp:8001,uai-utils-mcp.uai.svc.cluster.local:8001,uai-everything-mcp:8002,uai-everything-mcp.uai.svc.cluster.local:8002",
  llmProvider: process.env.LLM_PROVIDER || "auto",
  llmApiKey: process.env.LLM_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "",
  maxToolSteps: parseInt(process.env.MAX_TOOL_STEPS || "5", 10),
};
