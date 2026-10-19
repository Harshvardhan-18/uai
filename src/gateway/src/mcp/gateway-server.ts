import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { upstreamPool } from "../upstream/client-pool.js";
import { pool } from "../db/index.js";
import { User } from "../types/index.js";
import { metrics } from "../metrics/index.js";

/**
 * Sanitize arguments for audit logging (never log passwords, tokens, or secrets)
 */
export function sanitizeArgs(args: any): any {
  if (!args || typeof args !== "object") return args;
  const sensitiveKeys = ["password", "token", "secret", "key", "authorization", "auth", "apiKey"];
  const copy = Array.isArray(args) ? [...args] : { ...args };

  for (const k of Object.keys(copy)) {
    const lower = k.toLowerCase();
    if (sensitiveKeys.some((s) => lower.includes(s))) {
      copy[k] = "[REDACTED]";
    } else if (typeof copy[k] === "object" && copy[k] !== null) {
      copy[k] = sanitizeArgs(copy[k]);
    }
  }

  return copy;
}

/**
 * Record tool execution in audit_logs table
 */
export async function recordAudit(entry: {
  userId?: number | null;
  userEmail?: string | null;
  serverSlug: string;
  toolName: string;
  durationMs: number;
  outcome: "success" | "error" | "timeout";
  errorMessage?: string | null;
  args?: any;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs 
       (user_id, user_email, server_slug, tool_name, duration_ms, outcome, error_message, request_args_sanitized)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.userId || null,
        entry.userEmail || null,
        entry.serverSlug,
        entry.toolName,
        entry.durationMs,
        entry.outcome,
        entry.errorMessage || null,
        JSON.stringify(sanitizeArgs(entry.args || {})),
      ]
    );

    metrics.recordToolCall(entry.serverSlug, entry.toolName, entry.outcome, entry.durationMs);
  } catch (err: any) {
    console.error("[audit] Failed to write audit log:", err.message);
  }
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { canUserAccessTool, getAccessDeniedMessage } from "../auth/permissions.js";

/**
 * Create a fresh aggregated Server instance for a client session
 */
export async function createGatewayMcpServer(user: User): Promise<Server> {
  const server = new Server(
    {
      name: "uai-mcp-gateway",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 1. tools/list handler (hidden from list if user is unauthorized)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await upstreamPool.listAggregatedTools();
    const visibleTools = tools.filter((t) => canUserAccessTool(user, t.name));

    return {
      tools: visibleTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema || { type: "object", properties: {} },
      })),
    };
  });

  // 2. tools/call handler (rejected on call if user is unauthorized)
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const start = Date.now();
    let outcome: "success" | "error" | "timeout" = "success";
    let errorMessage: string | null = null;
    let serverSlug = name.split("__")[0] || "unknown";
    let toolName = name.split("__").slice(1).join("__") || name;

    try {
      // Permission verification
      if (!canUserAccessTool(user, name)) {
        outcome = "error";
        errorMessage = getAccessDeniedMessage(user, name);
        return {
          isError: true,
          content: [{ type: "text", text: errorMessage }],
        };
      }

      const callResult = await upstreamPool.callAggregatedTool(name, args || {});
      serverSlug = callResult.serverSlug;
      toolName = callResult.toolName;
      return callResult.result;
    } catch (err: any) {
      const isTimeout = err.message?.includes("timed out");
      outcome = isTimeout ? "timeout" : "error";
      errorMessage = err.message || "Unknown error";
      return {
        isError: true,
        content: [{ type: "text", text: `[Gateway Error] ${errorMessage}` }],
      };
    } finally {
      const durationMs = Date.now() - start;
      await recordAudit({
        userId: user.id,
        userEmail: user.email,
        serverSlug,
        toolName,
        durationMs,
        outcome,
        errorMessage,
        args,
      });
    }
  });

  return server;
}
