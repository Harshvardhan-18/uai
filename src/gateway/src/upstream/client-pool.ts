import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { pool } from "../db/index.js";
import { decrypt } from "../crypto/encryption.js";
import { config } from "../config.js";
import { AggregatedTool, UpstreamServer } from "../types/index.js";
import { validateUpstreamUrl } from "../crypto/ssrf-guard.js";

interface ActiveConnection {
  client: Client;
  transport: any;
  server: UpstreamServer;
}

export class UpstreamPool {
  private connections = new Map<string, ActiveConnection>();
  private toolCache: { tools: AggregatedTool[]; timestamp: number } | null = null;

  /**
   * Invalidate cached tools (called when servers are added, modified, or toggled)
   */
  invalidateCache(): void {
    this.toolCache = null;
  }

  /**
   * Helper: wrap promise with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }

  /**
   * Get or create client connection for an upstream server
   */
  private async getClient(server: UpstreamServer): Promise<Client> {
    const existing = this.connections.get(server.slug);
    if (existing) {
      return existing.client;
    }

    // Connection-time SSRF re-validation
    const ssrfCheck = await validateUpstreamUrl(server.url);
    if (!ssrfCheck.valid) {
      throw new Error(`SSRF blocked connection to ${server.name} (${server.url}): ${ssrfCheck.reason}`);
    }

    // Build custom headers if authentication configured
    const requestHeaders: Record<string, string> = {};
    if (server.auth_type === "bearer" && server.auth_token_encrypted) {
      const token = decrypt(server.auth_token_encrypted);
      requestHeaders["Authorization"] = `Bearer ${token}`;
    } else if (server.auth_type === "header" && server.auth_header_name && server.auth_token_encrypted) {
      const token = decrypt(server.auth_token_encrypted);
      requestHeaders[server.auth_header_name] = token;
    }

    const url = new URL(server.url);
    let transport: any;

    if (server.url.includes("/mcp") || !server.url.includes("/sse")) {
      transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: requestHeaders,
          redirect: "error", // B8: Prevent open redirect SSRF bypasses
        },
      });
    } else {
      transport = new SSEClientTransport(url, {
        eventSourceInit: {
          headers: requestHeaders,
        } as any,
        requestInit: {
          headers: requestHeaders,
          redirect: "error", // B8: Prevent open redirect SSRF bypasses
        },
      });
    }

    const client = new Client(
      {
        name: "uai-gateway-client",
        version: "0.1.0",
      },
      {
        capabilities: {},
      }
    );

    await this.withTimeout(client.connect(transport), config.upstreamTimeoutList, `Connecting to ${server.name}`);

    this.connections.set(server.slug, {
      client,
      transport,
      server,
    });

    return client;
  }

  /**
   * Sanitize tool name for LLM compatibility (^[a-zA-Z0-9_-]{1,64}$)
   */
  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 64);
  }

  /**
   * List all tools across all enabled upstreams using Promise.allSettled
   */
  async listAggregatedTools(): Promise<AggregatedTool[]> {
    const now = Date.now();
    if (this.toolCache && now - this.toolCache.timestamp < config.toolCacheTtlMs) {
      return this.toolCache.tools;
    }

    // Query enabled servers from database
    const dbResult = await pool.query<UpstreamServer>(
      "SELECT * FROM servers WHERE enabled = true ORDER BY name ASC"
    );
    const servers = dbResult.rows;

    // Concurrently fetch tools with per-upstream timeout using Promise.allSettled
    const results = await Promise.allSettled(
      servers.map(async (server) => {
        try {
          const client = await this.getClient(server);
          const response = await this.withTimeout(
            client.listTools(),
            config.upstreamTimeoutList,
            `Listing tools from ${server.name}`
          );

          // Map and namespace tools as `<serverSlug>__<toolName>`
          return response.tools.map((t) => {
            const rawName = `${server.slug}__${t.name}`;
            const namespacedName = this.sanitizeName(rawName);
            return {
              name: namespacedName,
              originalName: t.name,
              serverSlug: server.slug,
              serverName: server.name,
              description: `[${server.name}] ${t.description || ""}`,
              inputSchema: t.inputSchema,
            } as AggregatedTool;
          });
        } catch (err: any) {
          // If server connection fails, remove broken connection from pool
          this.connections.delete(server.slug);
          console.warn(`[pool] Failed to fetch tools from ${server.name} (${server.slug}): ${err.message}`);
          throw err;
        }
      })
    );

    const aggregated: AggregatedTool[] = [];
    results.forEach((res) => {
      if (res.status === "fulfilled") {
        aggregated.push(...res.value);
      }
    });

    this.toolCache = {
      tools: aggregated,
      timestamp: now,
    };

    return aggregated;
  }

  /**
   * Call an aggregated tool by parsing prefix: `<serverSlug>__<toolName>`
   */
  async callAggregatedTool(
    namespacedName: string,
    args: any = {}
  ): Promise<{ result: any; serverSlug: string; toolName: string }> {
    const parts = namespacedName.split("__");
    if (parts.length < 2) {
      throw new Error(
        `Invalid tool name format: "${namespacedName}". Expected "<serverSlug>__<toolName>"`
      );
    }

    const serverSlug = parts[0];
    const toolName = parts.slice(1).join("__");

    // Fetch server from database
    const dbResult = await pool.query<UpstreamServer>(
      "SELECT * FROM servers WHERE slug = $1",
      [serverSlug]
    );

    if (dbResult.rowCount === 0) {
      throw new Error(`Upstream server with slug "${serverSlug}" not found`);
    }

    const server = dbResult.rows[0];
    if (!server.enabled) {
      throw new Error(`Upstream server "${server.name}" (${serverSlug}) is currently disabled`);
    }

    try {
      const client = await this.getClient(server);
      const callPromise = client.callTool({
        name: toolName,
        arguments: args,
      });

      const response = await this.withTimeout(
        callPromise,
        config.upstreamTimeoutCall,
        `Calling ${namespacedName}`
      );

      return {
        result: response,
        serverSlug,
        toolName,
      };
    } catch (err: any) {
      // Evict broken connection
      this.connections.delete(serverSlug);
      throw err;
    }
  }

  /**
   * Close all active upstream connections
   */
  async closeAll(): Promise<void> {
    for (const [slug, conn] of this.connections.entries()) {
      try {
        await conn.client.close();
      } catch {}
    }
    this.connections.clear();
  }
}

export const upstreamPool = new UpstreamPool();
