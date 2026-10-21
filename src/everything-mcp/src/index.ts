import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = parseInt(process.env.PORT || "8002", 10);

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "everything-mcp",
    version: "0.1.0",
  });

  // Tool 1: echo (intentionally identical name to utils-mcp to prove collision isolation)
  server.tool(
    "echo",
    "Echo back a message with everything-mcp server attribution.",
    {
      message: z.string().describe("Message to echo back"),
    },
    async ({ message }) => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              server: "everything-mcp",
              echo: message,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      };
    }
  );

  // Tool 2: add
  server.tool(
    "add",
    "Add two numbers together.",
    {
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
    },
    async ({ a, b }) => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              a,
              b,
              sum: a + b,
            }),
          },
        ],
      };
    }
  );

  // Tool 3: get_sample_data
  server.tool(
    "get_sample_data",
    "Get a sample list of system items.",
    {
      count: z.number().optional().default(3).describe("Number of items to generate"),
    },
    async ({ count }) => {
      const items = Array.from({ length: Math.min(count, 10) }, (_, i) => ({
        id: i + 1,
        name: `Sample Item ${i + 1}`,
        active: i % 2 === 0,
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(items, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "everything-mcp",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  });
});

// Streamable HTTP endpoint (stateless)
app.all("/mcp", async (req: Request, res: Response) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcpServer = createMcpServer();
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const transports = new Map<string, SSEServerTransport>();

app.get("/sse", async (req: Request, res: Response) => {
  console.log(`[everything-mcp] New incoming SSE connection from ${req.ip}`);
  const mcpServer = createMcpServer();
  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport.sessionId, transport);

  req.on("close", () => {
    transports.delete(transport.sessionId);
  });

  await mcpServer.connect(transport);
});

app.post("/messages", async (req: Request, res: Response) => {
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

  await transport.handlePostMessage(req, res);
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`everything-mcp server listening on port ${PORT}`);
  console.log(`SSE endpoint:    http://0.0.0.0:${PORT}/sse`);
  console.log(`Messages POST:   http://0.0.0.0:${PORT}/messages`);
  console.log(`Health endpoint: http://0.0.0.0:${PORT}/health`);
});

process.on("SIGTERM", () => {
  console.log("[everything-mcp] SIGTERM received. Shutting down HTTP server immediately...");
  if ((server as any).closeAllConnections) {
    (server as any).closeAllConnections();
  }
  server.close(() => {
    console.log("[everything-mcp] Server closed.");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
});
