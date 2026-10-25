import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const apiKey = process.argv[2];
if (!apiKey) {
  console.error("Usage: node src/gateway/demo-client.mjs <gw_api_key>");
  process.exit(1);
}

const BASE_URL = "http://app.localtest.me";

async function main() {
  console.log(`Connecting to ${BASE_URL}/mcp with API key: ${apiKey.substring(0, 10)}...`);

  try {
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
    });
    const client = new Client({ name: "demo-external-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    console.log(" Connected to MCP Gateway via Streamable HTTP!\n");

    // 1. List Tools across all upstreams
    console.log("--- Listing Aggregated Tools ---");
    const { tools } = await client.listTools();
    console.log(` Total Tools Exposed: ${tools.length}`);
    const servers = [...new Set(tools.map((t) => t.name.split("__")[0]))];
    console.log(` Upstream Servers Found: ${servers.join(", ")}`);
    console.log(` Sample Tools: ${tools.slice(0, 4).map((t) => t.name).join(", ")}...\n`);

    // 2. Call Tool 1 from 'utils'
    console.log("--- Calling Tool 1: utils__get_current_time ---");
    const timeRes = await client.callTool({
      name: "utils__get_current_time",
      arguments: { timezone: "Asia/Kolkata" },
    });
    console.log(" Result:", timeRes.content[0].text);

    // 3. Call Tool 2 from 'woo'
    console.log("\n--- Calling Tool 2: woo__list_products ---");
    const prodRes = await client.callTool({
      name: "woo__list_products",
      arguments: { per_page: 2 },
    });
    const products = JSON.parse(prodRes.content[0].text);
    console.log(` Retrieved ${products.length} products:`);
    products.forEach((p) => console.log(`   - [ID ${p.id}] ${p.name} ($${p.price})`));

    await client.close();
    console.log("\n External MCP Client Demonstration Succeeded!");
  } catch (err) {
    console.error("\n MCP Client Request Failed:", err.message);
    if (err.message.includes("401") || err.message.includes("Unauthorized")) {
      console.log(" Enforcement Verified: Revoked/invalid keys are immediately rejected with HTTP 401!");
    }
    process.exit(1);
  }
}

main();
