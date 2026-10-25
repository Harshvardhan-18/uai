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

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: any;
  parseError?: string;
  rawArguments?: string;
}

export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens?: number;
  total_tokens: number;
}

export interface LLMResponse {
  content: string;
  tool_calls?: LLMToolCall[];
  usage?: LLMUsage;
}

export interface LLMProvider {
  name: string;
  model: string;
  chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    onRateLimit?: (seconds: number) => void
  ): Promise<LLMResponse>;
}

/**
 * Smart Deterministic Intent Provider
 * Operates offline / without cloud API keys, executing real tool loops and generating answers.
 */
export class SmartIntentProvider implements LLMProvider {
  name = "smart-intent-fallback";
  model = "smart-intent-fallback";

  async chat(
    messages: ChatMessage[],
    _tools: ToolDefinition[],
    _onRateLimit?: (seconds: number) => void
  ): Promise<LLMResponse> {
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
        let permalink = prod.permalink || `http://store.localtest.me/product/${prodId}`;
        permalink = permalink.replace(/^https:\/\/store\.localtest\.me/, "http://store.localtest.me");
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
      const todayIso = new Date().toISOString().split("T")[0];
      const afterDate = `${todayIso}T00:00:00Z`;
      const beforeDate = `${todayIso}T23:59:59Z`;
      return {
        content: "Checking the WooCommerce store for today's orders...",
        tool_calls: [
          {
            id: `call_${Date.now()}`,
            name: "woo__list_orders",
            arguments: { after: afterDate, before: beforeDate, per_page: 10 },
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

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  providerName: string,
  maxRetries = 3,
  onRateLimit?: (seconds: number) => void
): Promise<Response> {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        const errText = await res.text();
        console.warn(`[llm-trace] ${providerName} attempt ${attempt} returned HTTP ${res.status}: ${errText.substring(0, 200)}`);
        if (attempt >= maxRetries) {
          throw new Error(`${providerName} API error (${res.status}): ${errText}`);
        }
        const retryAfterSec = parseInt(res.headers.get("retry-after") || "0", 10);
        const backoffMs = retryAfterSec > 0 ? retryAfterSec * 1000 : Math.pow(2, attempt) * 1000;
        const waitSec = Math.ceil(backoffMs / 1000);
        console.log(`[llm-trace] ${providerName} 429/5xx detected. Backing off for ${backoffMs}ms before retry attempt ${attempt + 1}...`);
        if (onRateLimit) {
          onRateLimit(waitSec);
        }
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      return res;
    } catch (err: any) {
      if (attempt >= maxRetries) throw err;
      const backoffMs = Math.pow(2, attempt) * 1000;
      const waitSec = Math.ceil(backoffMs / 1000);
      console.warn(`[llm-trace] ${providerName} network error on attempt ${attempt}: ${err.message}. Retrying in ${backoffMs}ms...`);
      if (onRateLimit) {
        onRateLimit(waitSec);
      }
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw new Error(`${providerName} exceeded maximum retries (${maxRetries})`);
}

/**
 * Gemini Provider (Google Gemini API)
 */
export class GeminiProvider implements LLMProvider {
  name = "gemini";
  public model: string;
  private apiKey: string;

  constructor(apiKey: string, model: string = "gemini-2.5-flash") {
    this.apiKey = apiKey;
    this.model = model || "gemini-2.5-flash";
  }

  async chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    onRateLimit?: (seconds: number) => void
  ): Promise<LLMResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    console.log(`[llm-trace] Gemini Request -> Model: ${this.model}, Endpoint: https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent (Tools: ${tools.length})`);

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

    const res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      "Gemini"
    );

    const data = (await res.json()) as any;
    console.log(`[llm-trace] Gemini Response -> Status: ${res.status}, Candidates: ${data.candidates?.length || 0}`);
    const candidate = data.candidates?.[0]?.content?.parts || [];
    let text = "";
    const toolCalls: any[] = [];

    for (const part of candidate) {
      if (part.text) text += part.text;
      if (part.functionCall) {
        console.log(`[llm-trace] Gemini Tool Call -> ${part.functionCall.name} args:`, JSON.stringify(part.functionCall.args));
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
  public model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(name: string, baseUrl: string, apiKey: string, model: string) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    onRateLimit?: (seconds: number) => void
  ): Promise<LLMResponse> {
    console.log(`[llm-trace] ${this.name} Request -> Model: ${this.model}, BaseUrl: ${this.baseUrl} (Tools: ${tools.length})`);
    const lastToolMsg = messages.filter((m) => m.role === "tool").pop();
    if (lastToolMsg) {
      console.log(`[llm-trace] Tool Result Fed Back -> ${lastToolMsg.name}: ${lastToolMsg.content.substring(0, 150)}`);
    }
    const formattedTools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const res = await fetchWithRetry(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools: formattedTools.length > 0 ? formattedTools : undefined,
          max_tokens: 1024,
        }),
      },
      this.name,
      3,
      onRateLimit
    );

    const data = (await res.json()) as any;
    console.log(`[llm-trace] ${this.name} Response -> Status: ${res.status}`);

    let usage: LLMUsage | undefined;
    if (data.usage) {
      const reasoning = data.usage.completion_tokens_details?.reasoning_tokens || 0;
      usage = {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        reasoning_tokens: reasoning,
        total_tokens: data.usage.total_tokens,
      };
      console.log(`[llm-trace] Step Usage -> Prompt: ${usage.prompt_tokens}, Reasoning: ${reasoning}, Completion: ${usage.completion_tokens}, Total: ${usage.total_tokens}`);
    }

    const choice = data.choices?.[0]?.message;
    const content = choice?.content || "";
    const toolCalls: LLMToolCall[] | undefined = choice?.tool_calls?.map((tc: any) => {
      let args: any = null;
      let parseError: string | undefined;
      const rawArgs = tc.function?.arguments;

      if (typeof rawArgs === "string") {
        try {
          args = JSON.parse(rawArgs);
        } catch (parseErr: any) {
          console.warn(`[llm-trace] Malformed tool call arguments string: "${rawArgs}". Attempting sanitization...`);
          try {
            const cleaned = rawArgs.replace(/,\s*([}\]])/g, "$1");
            args = JSON.parse(cleaned);
          } catch {
            console.warn(`[llm-trace] Sanitization failed permanently, setting parseError.`);
            args = null;
            parseError = parseErr.message || "Invalid JSON in arguments";
          }
        }
      } else if (rawArgs && typeof rawArgs === "object") {
        args = rawArgs;
      } else {
        args = {};
      }

      return {
        id: tc.id,
        name: tc.function?.name,
        arguments: args,
        parseError,
        rawArguments: typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs),
      };
    });

    if (toolCalls && toolCalls.length > 0) {
      console.log(`[llm-trace] ${this.name} Tool Calls (${toolCalls.length}) ->`, toolCalls.map((t: any) => t.name).join(", "));
      for (const tc of toolCalls) {
        console.log(`[llm-trace] Model Tool Call -> ${tc.name} args: ${JSON.stringify(tc.arguments)}`);
      }
    } else {
      console.log(`[llm-trace] Final Model Response -> ${content.substring(0, 150)}`);
    }

    return {
      content,
      tool_calls: toolCalls,
      usage,
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
    return new GeminiProvider(apiKey, config.llmModel || "gemini-2.5-flash");
  }

  if ((provider === "groq" || (provider === "auto" && apiKey.startsWith("gsk_"))) && apiKey) {
    return new OpenAICompatibleProvider(
      "groq",
      "https://api.groq.com/openai/v1",
      apiKey,
      config.llmModel || "openai/gpt-oss-120b"
    );
  }

  // Smart fallback
  return new SmartIntentProvider();
}
