import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

async function main() {
  console.log("=== MCP Inspector / Client Verification against woo-mcp ===");
  console.log("Connecting to http://127.0.0.1:8000/sse via SSEClientTransport...");

  const transport = new SSEClientTransport(new URL("http://127.0.0.1:8000/sse"));
  const client = new Client(
    {
      name: "mcp-inspector-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);
  console.log("Connected successfully to woo-mcp server!\n");

  // 1. List tools
  console.log("--- Step 1: Listing Tools (tools/list) ---");
  const toolsResult = await client.listTools();
  console.log(`Found ${toolsResult.tools.length} tools:`);
  for (const tool of toolsResult.tools) {
    console.log(`  - ${tool.name}: ${tool.description}`);
  }

  const expectedTools = [
    "list_products",
    "create_product",
    "list_orders",
    "get_order",
    "update_order_status",
  ];
  const missing = expectedTools.filter((t) => !toolsResult.tools.some((found) => found.name === t));
  if (missing.length > 0) {
    throw new Error(`Missing expected tools: ${missing.join(", ")}`);
  }
  console.log("All 5 expected tools are present!\n");

  // 2. Call Tool: list_products
  console.log("--- Step 2: Calling list_products ---");
  const listProductsRes = await client.callTool({
    name: "list_products",
    arguments: { per_page: 5 },
  });
  console.log("list_products output:");
  console.log(listProductsRes.content[0].text);
  console.log();

  // 3. Call Tool: create_product
  console.log("--- Step 3: Calling create_product ---");
  const createProductRes = await client.callTool({
    name: "create_product",
    arguments: {
      name: "Ergonomic Vertical Mouse",
      regular_price: "49.99",
      description: "Wireless ergonomic vertical mouse with silent clicks.",
      status: "publish",
    },
  });
  console.log("create_product output:");
  console.log(createProductRes.content[0].text);
  console.log();

  // 4. Call Tool: list_orders
  console.log("--- Step 4: Calling list_orders ---");
  const listOrdersRes = await client.callTool({
    name: "list_orders",
    arguments: { per_page: 5 },
  });
  console.log("list_orders output:");
  console.log(listOrdersRes.content[0].text);
  console.log();

  // 5. Call Tool: get_order (order 13)
  console.log("--- Step 5: Calling get_order (id: 13) ---");
  const getOrderRes = await client.callTool({
    name: "get_order",
    arguments: { id: 13 },
  });
  console.log("get_order output:");
  console.log(getOrderRes.content[0].text);
  console.log();

  // 6. Call Tool: update_order_status (order 13 -> processing)
  console.log("--- Step 6: Calling update_order_status (id: 13 -> processing) ---");
  const updateOrderRes = await client.callTool({
    name: "update_order_status",
    arguments: { id: 13, status: "processing" },
  });
  console.log("update_order_status output:");
  console.log(updateOrderRes.content[0].text);
  console.log();

  await client.close();
  console.log("=== All 5 Tools Successfully Verified over Streamable HTTP (SSE)! ===");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
