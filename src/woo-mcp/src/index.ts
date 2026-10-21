import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { WooCommerceClient } from "./woo-client.js";

const PORT = parseInt(process.env.PORT || "8000", 10);
const WOO_URL = process.env.WOO_URL || "http://uai-woocommerce.uai.svc.cluster.local";
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY;
if (!WOO_CONSUMER_KEY) {
  throw new Error("FATAL CONFIG ERROR: Required environment variable WOO_CONSUMER_KEY is not set.");
}
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET;
if (!WOO_CONSUMER_SECRET) {
  throw new Error("FATAL CONFIG ERROR: Required environment variable WOO_CONSUMER_SECRET is not set.");
}

const wooClient = new WooCommerceClient({
  baseUrl: WOO_URL,
  consumerKey: WOO_CONSUMER_KEY,
  consumerSecret: WOO_CONSUMER_SECRET,
});

// Create MCP Server
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "woo-mcp",
    version: "0.1.0",
  });

  // Tool 1: list_products
  server.tool(
    "list_products",
    "List products from the WooCommerce store with optional search keyword, category, and pagination.",
    {
      search: z.string().optional().describe("Search keyword to filter products by title or description"),
      category: z.string().optional().describe("Category ID or slug to filter products"),
      per_page: z.number().optional().default(10).describe("Number of products to return (default: 10)"),
      page: z.number().optional().default(1).describe("Page number of results (default: 1)"),
    },
    async ({ search, category, per_page, page }) => {
      try {
        const products = await wooClient.listProducts({ search, category, per_page, page });
        const summary = products.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          regular_price: p.regular_price,
          status: p.status,
          stock_status: p.stock_status,
          permalink: p.permalink,
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error listing products: ${err.message}` }],
        };
      }
    }
  );

  // Tool 2: create_product
  server.tool(
    "create_product",
    "Create a new simple product in the WooCommerce store.",
    {
      name: z.string().describe("Product name / title"),
      regular_price: z.string().describe("Regular price in USD (e.g. '49.99' or '499')"),
      description: z.string().optional().describe("Full product description"),
      short_description: z.string().optional().describe("Short teaser description"),
      status: z.enum(["publish", "draft"]).optional().default("publish").describe("Product status (publish or draft)"),
    },
    async ({ name, regular_price, description, short_description, status }) => {
      try {
        const product = await wooClient.createProduct({
          name,
          regular_price,
          description,
          short_description,
          status,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: product.id,
                  name: product.name,
                  price: product.price,
                  status: product.status,
                  permalink: product.permalink,
                  message: `Successfully created product "${product.name}" with ID ${product.id}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error creating product: ${err.message}` }],
        };
      }
    }
  );

  // Tool 3: list_orders
  server.tool(
    "list_orders",
    "List orders from the WooCommerce store with optional filtering by status, date, and pagination.",
    {
      status: z
        .enum(["any", "pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"])
        .optional()
        .default("any")
        .describe("Order status filter"),
      after: z.string().optional().describe("Limit response to resources published after a given ISO8601 compliant date (e.g. '2026-10-19T00:00:00Z')"),
      before: z.string().optional().describe("Limit response to resources published before a given ISO8601 compliant date (e.g. '2026-10-21T23:59:59Z')"),
      per_page: z.number().optional().default(10).describe("Number of orders to return (default: 10)"),
      page: z.number().optional().default(1).describe("Page number (default: 1)"),
    },
    async ({ status, after, before, per_page, page }) => {
      try {
        const orders = await wooClient.listOrders({ status, after, before, per_page, page });
        const summary = orders.map((o) => ({
          id: o.id,
          status: o.status,
          currency: o.currency,
          total: o.total,
          customer: `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim(),
          payment_method: o.payment_method_title,
          date_created: o.date_created,
          line_items: o.line_items?.map((item: any) => ({
            id: item.id,
            name: item.name,
            product_id: item.product_id,
            quantity: item.quantity,
            total: item.total,
          })),
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error listing orders: ${err.message}` }],
        };
      }
    }
  );

  // Tool 4: get_order
  server.tool(
    "get_order",
    "Get full details for a specific order by ID.",
    {
      id: z.number().describe("The order ID"),
    },
    async ({ id }) => {
      try {
        const order = await wooClient.getOrder(id);
        const details = {
          id: order.id,
          status: order.status,
          currency: order.currency,
          total: order.total,
          subtotal: order.subtotal || order.total,
          customer: `${order.billing?.first_name || ""} ${order.billing?.last_name || ""}`.trim(),
          email: order.billing?.email,
          payment_method: order.payment_method_title,
          date_created: order.date_created,
          date_modified: order.date_modified,
          billing: order.billing,
          shipping: order.shipping,
          line_items: order.line_items?.map((item: any) => ({
            id: item.id,
            name: item.name,
            product_id: item.product_id,
            quantity: item.quantity,
            price: item.price,
            total: item.total,
          })),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error fetching order ${id}: ${err.message}` }],
        };
      }
    }
  );

  // Tool 5: update_order_status
  server.tool(
    "update_order_status",
    "Update the status of an existing WooCommerce order.",
    {
      id: z.number().describe("The order ID to update"),
      status: z
        .enum(["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"])
        .describe("New order status"),
    },
    async ({ id, status }) => {
      try {
        const updated = await wooClient.updateOrderStatus(id, status);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: updated.id,
                  status: updated.status,
                  date_modified: updated.date_modified,
                  message: `Order #${id} status successfully updated to "${updated.status}"`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error updating order ${id}: ${err.message}` }],
        };
      }
    }
  );

  return server;
}

// Start Express HTTP Server
const app = express();
app.use(express.json());

// Health check endpoint for Kubernetes liveness & readiness probes
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "woo-mcp",
    version: "0.1.0",
    wooUrl: WOO_URL,
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

// Map of active SSE transports by sessionId
const transports = new Map<string, SSEServerTransport>();

// Streamable HTTP: SSE endpoint
app.get("/sse", async (req: Request, res: Response) => {
  console.log(`[woo-mcp] New incoming SSE connection from ${req.ip}`);
  const mcpServer = createMcpServer();
  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport.sessionId, transport);

  req.on("close", () => {
    console.log(`[woo-mcp] SSE connection closed for session ${transport.sessionId}`);
    transports.delete(transport.sessionId);
  });

  await mcpServer.connect(transport);
});

// Streamable HTTP: Message handling endpoint
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
  console.log(`===============================================`);
  console.log(`woo-mcp server listening on port ${PORT}`);
  console.log(`SSE endpoint:    http://0.0.0.0:${PORT}/sse`);
  console.log(`Messages POST:   http://0.0.0.0:${PORT}/messages`);
  console.log(`Health endpoint: http://0.0.0.0:${PORT}/health`);
  console.log(`WooCommerce URL: ${WOO_URL}`);
  console.log(`===============================================`);
});

process.on("SIGTERM", () => {
  console.log("[woo-mcp] SIGTERM received. Shutting down HTTP server immediately...");
  if ((server as any).closeAllConnections) {
    (server as any).closeAllConnections();
  }
  server.close(() => {
    console.log("[woo-mcp] Server closed.");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
});
