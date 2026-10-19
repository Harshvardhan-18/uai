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

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgres://uai_user:REDACTED_POSTGRES_PASS@uai-postgres:5432/uai_gateway",
  encryptionKey,
  jwtSecret,
  adminEmail: process.env.ADMIN_EMAIL || "admin@localtest.me",
  adminPassword,
  upstreamTimeoutList: parseInt(process.env.UPSTREAM_TIMEOUT_LIST || "5000", 10),
  upstreamTimeoutCall: parseInt(process.env.UPSTREAM_TIMEOUT_CALL || "30000", 10),
  toolCacheTtlMs: parseInt(process.env.TOOL_CACHE_TTL_MS || "30000", 10),
  healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || "30000", 10),
  inClusterAllowlist: process.env.IN_CLUSTER_ALLOWLIST || "uai-woo-mcp,uai-utils-mcp,uai-everything-mcp,*.svc.cluster.local",
  llmProvider: process.env.LLM_PROVIDER || "auto",
  llmApiKey: process.env.LLM_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "",
  maxToolSteps: parseInt(process.env.MAX_TOOL_STEPS || "5", 10),
};
