import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const PORT = parseInt(process.env.PORT || "8001", 10);

// Currency conversion rates against USD
const USD_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.2,
  JPY: 154.5,
  CAD: 1.36,
  AUD: 1.52,
};

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "utils-mcp",
    version: "0.1.0",
  });

  // Tool 1: echo (intentionally common name to test tool collision handling)
  server.tool(
    "echo",
    "Echo back a message with utils-mcp server attribution.",
    {
      message: z.string().describe("Message to echo back"),
    },
    async ({ message }) => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              server: "utils-mcp",
              echo: message,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      };
    }
  );

  // Tool 2: get_current_time
  server.tool(
    "get_current_time",
    "Get the current system time with optional timezone formatting.",
    {
      timezone: z.string().optional().default("UTC").describe("Timezone (e.g. 'UTC', 'America/New_York', 'Asia/Kolkata')"),
    },
    async ({ timezone }) => {
      try {
        const now = new Date();
        const formatted = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          dateStyle: "full",
          timeStyle: "long",
        }).format(now);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                iso: now.toISOString(),
                formatted,
                timezone,
              }),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error getting time: ${err.message}` }],
        };
      }
    }
  );

  // Tool 3: convert_currency
  server.tool(
    "convert_currency",
    "Convert an amount between currencies (e.g. USD, EUR, GBP, INR, JPY, CAD, AUD).",
    {
      amount: z.number().describe("Numeric amount to convert"),
      from: z.string().describe("Source 3-letter currency code (e.g. 'USD')"),
      to: z.string().describe("Target 3-letter currency code (e.g. 'EUR')"),
    },
    async ({ amount, from, to }) => {
      const fromUpper = from.toUpperCase();
      const toUpper = to.toUpperCase();

      const rateFrom = USD_RATES[fromUpper];
      const rateTo = USD_RATES[toUpper];

      if (!rateFrom || !rateTo) {
        const supported = Object.keys(USD_RATES).join(", ");
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Unsupported currency. Supported: ${supported}`,
            },
          ],
        };
      }

      // Convert from -> USD -> to
      const amountInUsd = amount / rateFrom;
      const converted = Math.round(amountInUsd * rateTo * 100) / 100;
      const effectiveRate = Math.round((rateTo / rateFrom) * 10000) / 10000;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              original_amount: amount,
              from: fromUpper,
              converted_amount: converted,
              to: toUpper,
              rate: effectiveRate,
            }),
          },
        ],
      };
    }
  );

  return server;
}

const app = express();

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "utils-mcp",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  });
});

const transports = new Map<string, SSEServerTransport>();

app.get("/sse", async (req: Request, res: Response) => {
  console.log(`[utils-mcp] New incoming SSE connection from ${req.ip}`);
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`utils-mcp server listening on port ${PORT}`);
  console.log(`SSE endpoint:    http://0.0.0.0:${PORT}/sse`);
  console.log(`Messages POST:   http://0.0.0.0:${PORT}/messages`);
  console.log(`Health endpoint: http://0.0.0.0:${PORT}/health`);
});
