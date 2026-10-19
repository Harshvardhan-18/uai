import { pool } from "../db/index.js";

interface ToolCallMetric {
  server: string;
  tool: string;
  outcome: string;
  count: number;
  totalDurationMs: number;
}

class MetricsRegistry {
  private toolCalls: Map<string, { count: number; totalDurationMs: number }> = new Map();
  private activeSessions: number = 0;

  recordToolCall(server: string, tool: string, outcome: string, durationMs: number) {
    const key = `${server}|${tool}|${outcome}`;
    const existing = this.toolCalls.get(key) || { count: 0, totalDurationMs: 0 };
    existing.count++;
    existing.totalDurationMs += durationMs;
    this.toolCalls.set(key, existing);
  }

  setSessions(count: number) {
    this.activeSessions = count;
  }

  async getMetrics(): Promise<string> {
    const lines: string[] = [];

    // 1. Tool Calls Counter & Duration
    lines.push("# HELP mcp_gateway_tool_calls_total Total number of MCP tool calls processed by the gateway");
    lines.push("# TYPE mcp_gateway_tool_calls_total counter");

    for (const [key, val] of this.toolCalls.entries()) {
      const [server, tool, outcome] = key.split("|");
      lines.push(`mcp_gateway_tool_calls_total{server="${server}",tool="${tool}",outcome="${outcome}"} ${val.count}`);
    }

    lines.push("\n# HELP mcp_gateway_tool_call_duration_seconds_total Total duration of MCP tool calls in seconds");
    lines.push("# TYPE mcp_gateway_tool_call_duration_seconds_total counter");

    for (const [key, val] of this.toolCalls.entries()) {
      const [server, tool, outcome] = key.split("|");
      const durationSec = (val.totalDurationMs / 1000).toFixed(4);
      lines.push(`mcp_gateway_tool_call_duration_seconds_total{server="${server}",tool="${tool}",outcome="${outcome}"} ${durationSec}`);
    }

    // 2. Upstream Servers Health
    try {
      const serversRes = await pool.query("SELECT slug, health_status, enabled FROM servers");
      lines.push("\n# HELP mcp_gateway_upstream_status Health status of upstream MCP servers (1=healthy/connected, 0=unhealthy/disabled)");
      lines.push("# TYPE mcp_gateway_upstream_status gauge");

      for (const s of serversRes.rows) {
        const isHealthy = s.enabled && s.health_status === "Connected" ? 1 : 0;
        lines.push(`mcp_gateway_upstream_status{server="${s.slug}",status="${s.health_status}",enabled="${s.enabled}"} ${isHealthy}`);
      }
    } catch {
      // ignore db error in metrics output
    }

    // 3. Organization Statistics
    try {
      const counts = await pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM api_keys WHERE revoked = false) as active_keys,
          (SELECT COUNT(*) FROM users) as total_users,
          (SELECT COUNT(*) FROM audit_logs) as total_audits
      `);
      if (counts.rowCount && counts.rowCount > 0) {
        const row = counts.rows[0];
        lines.push("\n# HELP mcp_gateway_active_api_keys Total active API keys");
        lines.push("# TYPE mcp_gateway_active_api_keys gauge");
        lines.push(`mcp_gateway_active_api_keys ${row.active_keys || 0}`);

        lines.push("\n# HELP mcp_gateway_registered_users Total registered users");
        lines.push("# TYPE mcp_gateway_registered_users gauge");
        lines.push(`mcp_gateway_registered_users ${row.total_users || 0}`);

        lines.push("\n# HELP mcp_gateway_audit_records_total Total recorded audit logs");
        lines.push("# TYPE mcp_gateway_audit_records_total counter");
        lines.push(`mcp_gateway_audit_records_total ${row.total_audits || 0}`);
      }
    } catch {}

    lines.push("");
    return lines.join("\n");
  }
}

export const metrics = new MetricsRegistry();
