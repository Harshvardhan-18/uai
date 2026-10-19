import { pool } from "../db/index.js";
import { config } from "../config.js";
import { UpstreamServer } from "../types/index.js";

export class HealthChecker {
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    console.log(`[health] Starting background health checker (interval: ${config.healthCheckIntervalMs}ms)`);
    // Run initial check after 2 seconds
    setTimeout(() => this.checkAll(), 2000);
    this.timer = setInterval(() => this.checkAll(), config.healthCheckIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkServer(server: UpstreamServer): Promise<{ status: string; error: string | null }> {
    if (!server.enabled) {
      return { status: "Disabled", error: null };
    }

    try {
      // Determine health check URL (e.g. replace /sse with /health, or test GET /sse)
      let testUrl = server.url;
      if (testUrl.endsWith("/sse")) {
        testUrl = testUrl.replace(/\/sse$/, "/health");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.upstreamTimeoutList);

      try {
        const res = await fetch(testUrl, {
          signal: controller.signal,
          headers: { Accept: "application/json, text/plain, */*" },
        });

        if (res.ok) {
          return { status: "Connected", error: null };
        }
        return { status: "Unreachable", error: `HTTP ${res.status} ${res.statusText}` };
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: any) {
      return { status: "Unreachable", error: err.message || "Connection failed" };
    }
  }

  async checkAll(): Promise<void> {
    try {
      const res = await pool.query<UpstreamServer>("SELECT * FROM servers ORDER BY id ASC");
      for (const server of res.rows) {
        const { status, error } = await this.checkServer(server);
        await pool.query(
          `UPDATE servers 
           SET health_status = $1, health_error = $2, last_health_check = NOW()
           WHERE id = $3`,
          [status, error, server.id]
        );
      }
    } catch (err: any) {
      console.warn(`[health] Health check cycle failed: ${err.message}`);
    }
  }
}

export const healthChecker = new HealthChecker();
