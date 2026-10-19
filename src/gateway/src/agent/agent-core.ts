import { User } from "../types/index.js";
import { upstreamPool } from "../upstream/client-pool.js";
import { recordAudit } from "../mcp/gateway-server.js";
import { getLLMProvider, ChatMessage, ToolDefinition } from "./llm-provider.js";
import { config } from "../config.js";
import { canUserAccessTool, getAccessDeniedMessage } from "../auth/permissions.js";

export interface AgentEvent {
  type: "thought" | "tool_call_start" | "tool_call_end" | "delta" | "done" | "error";
  content?: string;
  tool?: string;
  args?: any;
  result?: any;
  isError?: boolean;
}

/**
 * Execute a tool directly through the gateway core with the logged-in user's identity
 * Ensures strict audit logging and parameter sanitization.
 */
export async function executeToolAsUser(
  user: User,
  namespacedToolName: string,
  args: any
): Promise<any> {
  const start = Date.now();
  let outcome: "success" | "error" | "timeout" = "success";
  let errorMessage: string | null = null;
  let serverSlug = namespacedToolName.split("__")[0] || "unknown";
  let toolName = namespacedToolName.split("__").slice(1).join("__") || namespacedToolName;

  try {
    if (!canUserAccessTool(user, namespacedToolName)) {
      outcome = "error";
      errorMessage = getAccessDeniedMessage(user, namespacedToolName);
      return {
        isError: true,
        content: [{ type: "text", text: errorMessage }],
      };
    }

    const callResult = await upstreamPool.callAggregatedTool(namespacedToolName, args || {});
    serverSlug = callResult.serverSlug;
    toolName = callResult.toolName;
    return callResult.result;
  } catch (err: any) {
    const isTimeout = err.message?.includes("timed out");
    outcome = isTimeout ? "timeout" : "error";
    errorMessage = err.message || "Unknown error";
    return {
      isError: true,
      content: [{ type: "text", text: `[Gateway Error] ${errorMessage}` }],
    };
  } finally {
    const durationMs = Date.now() - start;
    await recordAudit({
      userId: user.id,
      userEmail: user.email,
      serverSlug,
      toolName,
      durationMs,
      outcome,
      errorMessage,
      args,
    });
  }
}

/**
 * Run the Autonomous Tool Loop for the Chat Agent
 */
export async function runAgentLoop(options: {
  user: User;
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  maxSteps?: number;
  onEvent: (event: AgentEvent) => void;
}): Promise<string> {
  const { user, message, history = [], maxSteps = config.maxToolSteps, onEvent } = options;

  // 1. Fetch available tools aggregated by gateway and filter by user role permissions
  const rawTools = await upstreamPool.listAggregatedTools();
  const visibleTools = rawTools.filter((t) => canUserAccessTool(user, t.name));
  const tools: ToolDefinition[] = visibleTools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema || { type: "object", properties: {} },
  }));

  // 2. Build conversation context
  const systemPrompt = `You are the UAI Assistant, an intelligent operational assistant connected to WooCommerce and internal utility services on Kubernetes.
You have access to ${tools.length} live tools through the UAI MCP Gateway.
Always use appropriate tools when user asks to query or modify store data (e.g. creating products, fetching orders, currency conversion).
When user asks for products or orders, call the woo tools.
When user asks to convert currencies, call utils__convert_currency.
Keep responses concise, clear, and professional.`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  const provider = getLLMProvider();
  let step = 0;
  let finalResponse = "";

  while (step < maxSteps) {
    step++;

    onEvent({
      type: "thought",
      content: step === 1 ? `Analyzing request with ${provider.name}...` : `Processing tool output (Step ${step})...`,
    });

    const response = await provider.chat(messages, tools);

    // If no tool calls requested, we have reached the final answer
    if (!response.tool_calls || response.tool_calls.length === 0) {
      finalResponse = response.content;
      onEvent({ type: "delta", content: finalResponse });
      break;
    }

    // Record model's assistant message with tool calls in history
    messages.push({
      role: "assistant",
      content: response.content || "",
      tool_calls: response.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    });

    // Execute each requested tool call through the gateway as the logged-in user
    for (const toolCall of response.tool_calls) {
      onEvent({
        type: "tool_call_start",
        tool: toolCall.name,
        args: toolCall.arguments,
      });

      const toolResult = await executeToolAsUser(user, toolCall.name, toolCall.arguments);

      const isError = toolResult.isError === true;
      const textContent = toolResult.content?.[0]?.text || JSON.stringify(toolResult);

      onEvent({
        type: "tool_call_end",
        tool: toolCall.name,
        result: textContent,
        isError,
      });

      // Feed result back into conversation
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolCall.name,
        content: textContent,
      });
    }
  }

  // If reached max steps without final text, synthesize one
  if (!finalResponse) {
    const finalStep = await provider.chat(messages, []);
    finalResponse = finalStep.content || "Completed tool executions.";
    onEvent({ type: "delta", content: finalResponse });
  }

  onEvent({ type: "done", content: finalResponse });
  return finalResponse;
}
