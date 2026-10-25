import { User } from "../types/index.js";
import { upstreamPool } from "../upstream/client-pool.js";
import { recordAudit } from "../mcp/gateway-server.js";
import { getLLMProvider, SmartIntentProvider, ChatMessage, ToolDefinition } from "./llm-provider.js";
import { config } from "../config.js";
import { canUserAccessTool, getAccessDeniedMessage, isWriteTool } from "../auth/permissions.js";
import { pool } from "../db/index.js";

export interface PendingConfirmation {
  id: string;
  tool: string;
  args: any;
  userId: number;
  resolve: (decision: { approved: boolean; reason?: string }) => void;
  timer: NodeJS.Timeout;
}

export const pendingConfirmations = new Map<string, PendingConfirmation>();

export function resolveConfirmation(
  id: string,
  userId: number,
  approved: boolean,
  reason?: string
): boolean {
  const item = pendingConfirmations.get(id);
  if (!item) return false;
  if (item.userId !== userId) return false;
  clearTimeout(item.timer);
  pendingConfirmations.delete(id);
  item.resolve({ approved, reason });
  return true;
}

export interface AgentEvent {
  type:
    | "meta"
    | "thought"
    | "tool_call_start"
    | "tool_call_end"
    | "delta"
    | "done"
    | "error"
    | "rate_limit"
    | "confirmation_required"
    | "confirmation_result"
    | "step_usage";
  provider?: string;
  model?: string;
  isFallback?: boolean;
  content?: string;
  tool?: string;
  args?: any;
  result?: any;
  isError?: boolean;
  confirmationId?: string;
  approved?: boolean;
  reason?: string;
  step?: number;
  usage?: any;
}

function optimizeSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {} };
  const copy = JSON.parse(JSON.stringify(schema));
  delete copy["$schema"];
  delete copy["title"];
  delete copy["additionalProperties"];
  if (copy.properties) {
    for (const [k, v] of Object.entries(copy.properties) as [string, any][]) {
      if (v.description && v.description.length > 80) {
        v.description = v.description.substring(0, 80);
      }
    }
  }
  return copy;
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
    description: (t.description || "").replace(/^\[[^\]]+\]\s*/, "").substring(0, 85),
    parameters: optimizeSchema(t.inputSchema),
  }));

  // 2. Build conversation context with explicit Date and Time injection (Item 9: Asia/Kolkata timezone)
  const tz = config.siteTimezone || "Asia/Kolkata";
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const isoStartOfDay = `${dateParts}T00:00:00+05:30`;
  const isoEndOfDay = `${dateParts}T23:59:59+05:30`;

  const systemPrompt = `You are the UAI Assistant, an intelligent operational assistant connected to WooCommerce and internal utility services on Kubernetes.
Current timestamp: ${now.toISOString()} (${tz}).
Today's date in ${tz} is: ${dateParts}.
Today's full-day window in ${tz} is after: "${isoStartOfDay}" and before: "${isoEndOfDay}".
You have access to ${tools.length} live tools through the UAI MCP Gateway.
When user asks for "today's orders" or "orders that came in today", ALWAYS supply the "after" parameter (set to start of today in ${tz}: "${isoStartOfDay}") and optionally "before" to woo__list_orders so orders from previous days are excluded.
When user asks to convert currencies, call utils__convert_currency.
If the user asks to get today's orders and convert the total to another currency (e.g. EUR), first call woo__list_orders to find the orders and their total, then after receiving the result, call utils__convert_currency with the total amount.
Keep responses concise, clear, and professional.`;

  // Trim history to last 6 messages to preserve token budget
  const trimmedHistory = (history || []).slice(-6);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...trimmedHistory.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  let provider = getLLMProvider();
  const isFallback = provider.name === "smart-intent-fallback";

  onEvent({
    type: "meta",
    provider: provider.name,
    model: provider.model || (isFallback ? "smart-intent-fallback" : "default"),
    isFallback,
  });

  let step = 0;
  let finalResponse = "";
  let malformedRetryCount = 0;

  while (step < maxSteps) {
    step++;

    onEvent({
      type: "thought",
      content: step === 1 ? `Analyzing request with ${provider.name} (${provider.model || "default"})...` : `Processing tool output (Step ${step})...`,
    });

    let response;
    try {
      response = await provider.chat(messages, tools, (waitSec) => {
        onEvent({
          type: "rate_limit",
          content: `Rate limited by ${provider.name}. Retrying in ${waitSec}s...`,
        });
      });
    } catch (err: any) {
      console.warn(`[agent] ${provider.name} failed: ${err.message}. Gracefully engaging smart-intent-fallback.`);
      provider = new SmartIntentProvider();
      onEvent({
        type: "meta",
        provider: provider.name,
        model: "smart-intent-fallback",
        isFallback: true,
      });
      response = await provider.chat(messages, tools);
    }

    // Emit step token usage if provided by LLM
    if (response.usage) {
      onEvent({
        type: "step_usage",
        step,
        usage: response.usage,
      });
    }

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
          arguments: tc.rawArguments || JSON.stringify(tc.arguments || {}),
        },
      })),
    });

    // Execute each requested tool call through the gateway as the logged-in user
    for (const toolCall of response.tool_calls) {
      // Item 6: Malformed arguments handling - never execute write tool with unparseable args
      if (toolCall.parseError || toolCall.arguments === null) {
        malformedRetryCount++;
        console.warn(`[agent] Malformed tool call arguments from model for ${toolCall.name} (retry count: ${malformedRetryCount})`);

        if (malformedRetryCount > 2) {
          const failMsg = `Execution halted: the model provided unparseable tool call arguments after 2 retries (${toolCall.parseError || "Malformed JSON"}).`;
          onEvent({ type: "error", content: failMsg });
          finalResponse = failMsg;
          return finalResponse;
        }

        const parseErrMsg = `Tool error: Your call to "${toolCall.name}" contained invalid/malformed JSON arguments: ${toolCall.parseError || "SyntaxError"}. You must retry the call with valid JSON formatted arguments.`;
        onEvent({
          type: "tool_call_start",
          tool: toolCall.name,
          args: { error: "unparseable_json", raw: toolCall.rawArguments },
        });
        onEvent({
          type: "tool_call_end",
          tool: toolCall.name,
          result: parseErrMsg,
          isError: true,
        });

        // Feed parse error back to the model as a tool error response WITHOUT executing the tool
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.name,
          content: JSON.stringify({ isError: true, error: parseErrMsg }),
        });
        continue;
      }

      // Write tool human-in-the-loop confirmation
      if (config.requireWriteConfirmation && isWriteTool(toolCall.name)) {
        const confId = `conf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        console.log(`[agent] Write confirmation REQUIRED for ${toolCall.name} (id: ${confId})`);

        onEvent({
          type: "confirmation_required",
          confirmationId: confId,
          tool: toolCall.name,
          args: toolCall.arguments,
        });

        const decision = await new Promise<{ approved: boolean; reason?: string }>((resolve) => {
          const timer = setTimeout(() => {
            pendingConfirmations.delete(confId);
            resolve({ approved: false, reason: "Confirmation timed out after 60s" });
          }, 60000);

          pendingConfirmations.set(confId, {
            id: confId,
            tool: toolCall.name,
            args: toolCall.arguments,
            userId: user.id,
            resolve,
            timer,
          });
        });

        if (!decision.approved) {
          const rejectReason = decision.reason || "Execution rejected by user in confirmation dialog";
          console.log(`[agent] Write tool ${toolCall.name} was REJECTED: ${rejectReason}`);

          // Audit the rejection in database
          const slug = toolCall.name.split("__")[0] || "unknown";
          await pool.query(
            `INSERT INTO audit_logs (user_id, user_email, server_slug, tool_name, duration_ms, outcome, error_message, request_args_sanitized)
             VALUES ($1, $2, $3, $4, $5, 'rejected', $6, $7)`,
            [user.id, user.email, slug, toolCall.name, 0, rejectReason, JSON.stringify(toolCall.arguments)]
          ).catch((e) => console.error("Failed to log audit rejection:", e.message));

          onEvent({
            type: "confirmation_result",
            confirmationId: confId,
            tool: toolCall.name,
            approved: false,
            reason: rejectReason,
          });

          const errorResult = `Execution rejected by user: User declined confirmation to execute "${toolCall.name}". Do not retry calling this tool. Inform the user that the action was cancelled as requested.`;
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.name,
            content: JSON.stringify({ isError: true, error: errorResult }),
          });
          continue;
        }

        // Approved!
        console.log(`[agent] Write tool ${toolCall.name} was APPROVED by user`);
        onEvent({
          type: "confirmation_result",
          confirmationId: confId,
          tool: toolCall.name,
          approved: true,
        });
      }

      onEvent({
        type: "tool_call_start",
        tool: toolCall.name,
        args: toolCall.arguments,
      });

      console.log(`[llm-trace] Model Tool Call -> ${toolCall.name} args: ${JSON.stringify(toolCall.arguments)}`);

      const toolResult = await executeToolAsUser(user, toolCall.name, toolCall.arguments);

      const isError = toolResult.isError === true;
      const textContent = toolResult.content?.[0]?.text || JSON.stringify(toolResult);

      console.log(`[llm-trace] Tool Result Fed Back -> ${toolCall.name}: ${textContent.substring(0, 150)}`);

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

  console.log(`[llm-trace] Final Response -> ${finalResponse.substring(0, 150)}`);

  onEvent({
    type: "done",
    content: finalResponse,
    provider: provider.name,
    model: provider.model || (provider.name === "smart-intent-fallback" ? "smart-intent-fallback" : "default"),
    isFallback: provider.name === "smart-intent-fallback",
  });
  return finalResponse;
}
