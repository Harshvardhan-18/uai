import { config } from "../config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string; // JSON string
    };
  }>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
}

export interface LLMResponse {
  content: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: any;
  }>;
}

export interface LLMProvider {
  name: string;
  chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse>;
}

/**
 * Smart Deterministic Intent Provider
 * Operates offline / without cloud API keys, executing real tool loops and generating answers.
 */
export class SmartIntentProvider implements LLMProvider {
  name = "smart-intent-fallback";

  async chat(messages: ChatMessage[], _tools: ToolDefinition[]): Promise<LLMResponse> {
    const lastMsg = messages[messages.length - 1];

    // 1. If last message was a tool result, synthesize a final answer
    if (lastMsg.role === "tool") {
      let toolData: any = {};
      try {
        toolData = JSON.parse(lastMsg.content);
      } catch {
        toolData = lastMsg.content;
      }

      if (lastMsg.name === "woo__create_product") {
        const prod = Array.isArray(toolData) ? toolData[0] : toolData;
        const prodName = prod.name || "Product";
        const prodPrice = prod.price || prod.regular_price || "499";
        const prodId = prod.id || "new";
        const permalink = prod.permalink || `http://store.localtest.me/product/${prodId}`;
        return {
          content: `Product "${prodName}" has been successfully created in the WooCommerce catalog!\n\n- **Product ID:** ${prodId}\n- **Price:** $${prodPrice}\n- **Status:** Published\n- **Store URL:** [View on Storefront](${permalink})`,
        };
      }

      if (lastMsg.name === "woo__list_orders") {
        const orders = Array.isArray(toolData) ? toolData : [toolData];
        if (orders.length === 0) {
          return { content: "There are currently no orders placed in the store today." };
        }
        let report = `Found **${orders.length} order(s)**:\n\n`;
        for (const o of orders) {
          report += `- **Order #${o.id}**: Status: \`${o.status}\`, Total: **$${o.total} ${o.currency || "USD"}**, Customer: **${o.customer || "Guest"}** (Payment: ${o.payment_method || "COD"})\n`;
          if (o.line_items && o.line_items.length > 0) {
            report += `  - Items: ${o.line_items.map((i: any) => `${i.name} (x${i.quantity})`).join(", ")}\n`;
          }
        }
        return { content: report };
      }

      if (lastMsg.name === "utils__convert_currency") {
        return {
          content: `Currency conversion completed: **$${toolData.original_amount} ${toolData.from}** = **€${toolData.converted_amount} ${toolData.to}** (Exchange rate: ${toolData.rate}).`,
        };
      }

      if (lastMsg.name?.includes("echo")) {
        return {
          content: `Echo response from upstream server: "${toolData.echo || toolData.message || JSON.stringify(toolData)}"`,
        };
      }

      return {
        content: `Tool executed successfully. Output:\n\`\`\`json\n${JSON.stringify(toolData, null, 2)}\n\`\`\``,
      };
    }

    // 2. Parse User Message for Tool Invocations
    const rawText = (lastMsg.content || "").trim();
    const text = rawText.toLowerCase();

    // Intent: "create a product X at 499"
    const createMatch = rawText.match(/create(?:\s+a)?(?:\s+new)?\s+product\s+(?:'|")?([^'"]+?)(?:'|")?\s+at\s+\$?([0-9.]+)/i);
    if (createMatch) {
      const prodName = createMatch[1].trim();
      const prodPrice = createMatch[2].trim();
      return {
        content: `I'll create the product "${prodName}" priced at $${prodPrice} in your WooCommerce store.`,
        tool_calls: [
          {
            id: `call_${Date.now()}`,
            name: "woo__create_product",
            arguments: {
              name: prodName,
              regular_price: prodPrice,
              description: `High-quality ${prodName} added via UAI Agent.`,
              status: "publish",
            },
          },
        ],
      };
    }

    // Intent: "what orders came in today" / "list orders" / "get today's orders"
    if (text.includes("order") && (text.includes("today") || text.includes("what") || text.includes("list") || text.includes("get") || text.includes("show"))) {
      // Check if user also asked to convert to EUR: "get today's orders, then convert the total to EUR"
      return {
        content: "Checking the WooCommerce store for orders...",
        tool_calls: [
          {
            id: `call_${Date.now()}`,
            name: "woo__list_orders",
            arguments: { per_page: 5 },
          },
        ],
      };
    }

    // Intent: "convert <amount> <from> to <to>"
    const convertMatch = text.match(/convert\s+\$?([0-9.]+)\s*([a-z]{3})?\s*(?:in|to)\s*([a-z]{3})/i);
    if (convertMatch) {
      const amount = parseFloat(convertMatch[1]);
      const from = (convertMatch[2] || "USD").toUpperCase();
      const to = convertMatch[3].toUpperCase();
      return {
        content: `Converting $${amount} ${from} to ${to}...`,
        tool_calls: [
          {
            id: `call_${Date.now()}`,
            name: "utils__convert_currency",
            arguments: { amount, from, to },
          },
        ],
      };
    }

    // Intent: "echo <message>"
    const echoMatch = text.match(/echo\s+['"]?([^'"]+)['"]?/i);
    if (echoMatch) {
      return {
        content: "Invoking echo tool...",
        tool_calls: [
          {
            id: `call_${Date.now()}`,
            name: "utils__echo",
            arguments: { message: echoMatch[1].trim() },
          },
        ],
      };
    }

    // Default conversational greeting
    return {
      content: `I am the UAI Assistant. You can command me to manage your WooCommerce store and utility tools. For example:\n\n- *"Create a product Wireless Headphones at 499"*\n- *"What orders came in today?"*\n- *"Get today's orders, then convert the total to EUR"*\n- *"Echo Hello from utils"*`,
    };
  }
}

/**
 * Gemini Provider (Google Gemini API)
 */
export class GeminiProvider implements LLMProvider {
  name = "gemini";
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = "gemini-1.5-flash") {
    this.apiKey = apiKey;
    this.model = model || "gemini-1.5-flash";
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    // Convert messages to Gemini format
    const contents: any[] = [];
    let systemInstruction: string | undefined;

    for (const m of messages) {
      if (m.role === "system") {
        systemInstruction = m.content;
      } else if (m.role === "user") {
        contents.push({ role: "user", parts: [{ text: m.content }] });
      } else if (m.role === "assistant") {
        const parts: any[] = [];
        if (m.content) parts.push({ text: m.content });
        if (m.tool_calls) {
          for (const tc of m.tool_calls) {
            let args = tc.function.arguments;
            if (typeof args === "string") {
              try { args = JSON.parse(args); } catch {}
            }
            parts.push({
              functionCall: {
                name: tc.function.name,
                args,
              },
            });
          }
        }
        contents.push({ role: "model", parts });
      } else if (m.role === "tool") {
        let respData: any = {};
        try { respData = JSON.parse(m.content); } catch { respData = { result: m.content }; }
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: m.name,
                response: respData,
              },
            },
          ],
        });
      }
    }

    // Convert tools to Gemini functionDeclarations
    const functionDeclarations = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const body: any = {
      contents,
      tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Gemini API error (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    const candidate = data.candidates?.[0]?.content?.parts || [];
    let text = "";
    const toolCalls: any[] = [];

    for (const part of candidate) {
      if (part.text) text += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args,
        });
      }
    }

    return {
      content: text,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}

/**
 * OpenAI / Groq / Ollama Compatible Provider
 */
export class OpenAICompatibleProvider implements LLMProvider {
  name: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(name: string, baseUrl: string, apiKey: string, model: string) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const formattedTools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: formattedTools.length > 0 ? formattedTools : undefined,
      }),
    });

    if (!res.ok) {
      throw new Error(`${this.name} API error (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    const choice = data.choices?.[0]?.message;
    const content = choice?.content || "";
    const toolCalls = choice?.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments,
    }));

    return {
      content,
      tool_calls: toolCalls,
    };
  }
}

/**
 * Factory to instantiate configured or fallback LLM provider
 */
export function getLLMProvider(): LLMProvider {
  const provider = (config.llmProvider || "auto").toLowerCase();
  const apiKey = config.llmApiKey;

  if ((provider === "gemini" || (provider === "auto" && apiKey.startsWith("AIza"))) && apiKey) {
    return new GeminiProvider(apiKey, config.llmModel || "gemini-1.5-flash");
  }

  if ((provider === "groq" || (provider === "auto" && apiKey.startsWith("gsk_"))) && apiKey) {
    return new OpenAICompatibleProvider(
      "groq",
      "https://api.groq.com/openai/v1",
      apiKey,
      config.llmModel || "llama-3.3-70b-versatile"
    );
  }

  // Smart fallback
  return new SmartIntentProvider();
}
