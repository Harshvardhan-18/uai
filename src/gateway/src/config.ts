export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgres://uai_user:REDACTED_POSTGRES_PASS@uai-postgres:5432/uai_gateway",
  encryptionKey:
    process.env.ENCRYPTION_KEY ||
    "REDACTED_ENCRYPTION_KEY", // 32 bytes hex
  jwtSecret: process.env.JWT_SECRET || "REDACTED_JWT_SECRET",
  adminEmail: process.env.ADMIN_EMAIL || "admin@localtest.me",
  adminPassword: process.env.ADMIN_PASSWORD || "REDACTED_ADMIN_PASS",
  upstreamTimeoutList: parseInt(process.env.UPSTREAM_TIMEOUT_LIST || "5000", 10),
  upstreamTimeoutCall: parseInt(process.env.UPSTREAM_TIMEOUT_CALL || "30000", 10),
  toolCacheTtlMs: parseInt(process.env.TOOL_CACHE_TTL_MS || "30000", 10),
  healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || "30000", 10),
  llmProvider: process.env.LLM_PROVIDER || "auto",
  llmApiKey: process.env.LLM_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "",
  maxToolSteps: parseInt(process.env.MAX_TOOL_STEPS || "5", 10),
};
