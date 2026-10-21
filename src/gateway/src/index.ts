import express, { Request, Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { initDb, pool } from "./db/index.js";
import { sha256 } from "./crypto/encryption.js";
import { verifyJwt, authenticateRequest, requireAdmin } from "./auth/auth-service.js";
import { createGatewayMcpServer } from "./mcp/gateway-server.js";
import { healthChecker } from "./upstream/health-checker.js";
import { authRouter } from "./api/auth-routes.js";
import { serverRouter } from "./api/server-routes.js";
import { keyRouter } from "./api/key-routes.js";
import { auditRouter } from "./api/audit-routes.js";
import { userRouter } from "./api/user-routes.js";
import { chatRouter } from "./api/chat-routes.js";
import { metrics } from "./metrics/index.js";
import { User } from "./types/index.js";

const app = express();
app.set("trust proxy", 1);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// ── Health Check (Kubernetes Probes) ──
app.get("/health", async (_req: Request, res: Response) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      service: "uai-gateway",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(503).json({ status: "error", message: err.message });
  }
});

// ── Prometheus Metrics Exporter ──
const handleMetrics = async (_req: Request, res: Response) => {
  try {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    const output = await metrics.getMetrics();
    res.send(output);
  } catch (err: any) {
    res.status(500).send(`# Error generating metrics: ${err.message}\n`);
  }
};
// ── Metrics Endpoint (Admin authenticated on external API) ──
app.get("/api/metrics", authenticateRequest, requireAdmin, handleMetrics);

// ── Mount REST APIs ──
app.use("/api/auth", authRouter);
app.use("/api/servers", serverRouter);
app.use("/api/keys", keyRouter);
app.use("/api/audit", auditRouter);
app.use("/api/users", userRouter);
app.use("/api/chat", chatRouter);

// ── MCP Server Endpoint over Streamable HTTP (SSE) ──
const transports = new Map<string, SSEServerTransport>();

/**
 * Authenticate incoming MCP client request (Bearer API key or session cookie)
 */
async function authenticateMcpClient(req: Request): Promise<User | null> {
  const authHeader = req.headers.authorization;
  const queryKey = req.query.apiKey as string;
  const rawKey = authHeader?.startsWith("Bearer gw_")
    ? authHeader.substring(7).trim()
    : queryKey?.startsWith("gw_")
    ? queryKey.trim()
    : null;

  if (rawKey) {
    const keyHash = sha256(rawKey);
    const result = await pool.query(
      `SELECT k.id as key_id, k.revoked, u.id as user_id, u.email, u.role, u.created_at
       FROM api_keys k
       JOIN users u ON k.user_id = u.id
       WHERE k.key_hash = $1`,
      [keyHash]
    );

    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    if (row.revoked) return null; // Reject revoked key immediately

    pool.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [row.key_id]).catch(() => {});
    return {
      id: row.user_id,
      email: row.email,
      role: row.role,
      created_at: row.created_at,
    };
  }

  // Fallback to session cookie
  const cookie = req.cookies?.uai_session;
  if (cookie) {
    return verifyJwt(cookie);
  }

  return null;
}

// Handlers for both modern Streamable HTTP and legacy SSE
const handleMcp = async (req: Request, res: Response): Promise<void> => {
  const user = await authenticateMcpClient(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized: Valid API key (Bearer gw_...) or session required." });
    return;
  }

  // Distinguish legacy SSE (GET with text/event-stream only) from modern Streamable HTTP
  const isLegacySse =
    req.method === "GET" &&
    req.headers.accept?.includes("text/event-stream") &&
    !req.headers.accept?.includes("application/json");

  if (!isLegacySse) {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const gatewayServer = await createGatewayMcpServer(user);
    await gatewayServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // Fallback to legacy SSEServerTransport
  console.log(`[mcp] New legacy SSE client session connected for user: ${user.email}`);
  const gatewayServer = await createGatewayMcpServer(user);
  const transport = new SSEServerTransport("/mcp/messages", res);
  transports.set(transport.sessionId, transport);

  req.on("close", () => {
    console.log(`[mcp] Legacy SSE Session closed: ${transport.sessionId} (${user.email})`);
    transports.delete(transport.sessionId);
  });

  await gatewayServer.connect(transport);
};

app.all("/mcp", handleMcp);
app.get("/mcp/sse", handleMcp);

app.post("/mcp/messages", async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) {
    res.status(400).send("Missing sessionId parameter");
    return;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).send(`Session "${sessionId}" not found or expired`);
    return;
  }

  await transport.handlePostMessage(req, res, req.body);
});

// Start server after database initialization
async function start() {
  try {
    await initDb();
    healthChecker.start();

    // Internal Prometheus metrics exporter on dedicated port 9090
    const metricsApp = express();
    metricsApp.get("/metrics", handleMetrics);
    metricsApp.listen(9090, "0.0.0.0", () => {
      console.log("Internal Prometheus metrics listening on port 9090");
    });

    app.listen(config.port, "0.0.0.0", () => {
      console.log(`===============================================`);
      console.log(`UAI Gateway listening on port ${config.port}`);
      console.log(`MCP Endpoint:   http://0.0.0.0:${config.port}/mcp (Streamable HTTP + SSE)`);
      console.log(`REST APIs:      http://0.0.0.0:${config.port}/api/*`);
      console.log(`Internal Metr:  http://0.0.0.0:9090/metrics`);
      console.log(`Health Check:   http://0.0.0.0:${config.port}/health`);
      console.log(`===============================================`);
    });
  } catch (err: any) {
    console.error("[gateway] Fatal startup error:", err);
    process.exit(1);
  }
}

start();
