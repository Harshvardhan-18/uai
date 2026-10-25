import { Router, Response } from "express";
import { pool } from "../db/index.js";
import { authenticateRequest, AuthenticatedRequest } from "../auth/auth-service.js";
import { runAgentLoop, AgentEvent, resolveConfirmation } from "../agent/agent-core.js";

export const chatRouter = Router();

chatRouter.use(authenticateRequest);

// 1. POST /api/chat - Stream conversation with agent tool loop
chatRouter.post("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const { message, history = [], sessionId } = req.body;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message is required and must be a string." });
    return;
  }

  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const toolCallsMade: string[] = [];
  let finalContent = "";

  try {
    finalContent = await runAgentLoop({
      user,
      message,
      history,
      onEvent: (event: AgentEvent) => {
        if (event.type === "tool_call_start" && event.tool) {
          toolCallsMade.push(event.tool);
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
    });

    // Persist conversation to database
    let activeSessionId = sessionId;
    if (!activeSessionId) {
      const sessionRes = await pool.query(
        "INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING id",
        [user.id, message.substring(0, 50)]
      );
      activeSessionId = sessionRes.rows[0].id;
    }

    await pool.query(
      `INSERT INTO chat_messages (session_id, role, content, tool_calls)
       VALUES ($1, 'user', $2, null), ($1, 'assistant', $3, $4)`,
      [activeSessionId, message, finalContent, JSON.stringify(toolCallsMade)]
    );
  } catch (err: any) {
    console.error("[chat] Error running agent loop:", err.message);
    res.write(`data: ${JSON.stringify({ type: "error", content: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// 2. GET /api/chat/history - List recent user chat history
chatRouter.get("/history", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user!;
  try {
    const result = await pool.query(
      `SELECT s.id as session_id, s.title, s.created_at,
              json_agg(
                json_build_object(
                  'id', m.id,
                  'role', m.role,
                  'content', m.content,
                  'tool_calls', m.tool_calls,
                  'created_at', m.created_at
                ) ORDER BY m.id ASC
              ) as messages
       FROM chat_sessions s
       LEFT JOIN chat_messages m ON s.id = m.session_id
       WHERE s.user_id = $1
       GROUP BY s.id, s.title, s.created_at
       ORDER BY s.updated_at DESC
       LIMIT 10`,
      [user.id]
    );

    res.json({ sessions: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch chat history: ${err.message}` });
  }
});

// 3. POST /api/chat/confirm - Human-in-the-loop write confirmation
chatRouter.post("/confirm", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const { confirmationId, action, reason } = req.body;

  if (!confirmationId || !action) {
    res.status(400).json({ error: "confirmationId and action ('approve' | 'reject') are required." });
    return;
  }

  const approved = action === "approve";
  const ok = resolveConfirmation(confirmationId, user.id, approved, reason);
  if (!ok) {
    res.status(404).json({ error: "Confirmation not found, expired, or unauthorized." });
    return;
  }

  res.json({ success: true, action: approved ? "approved" : "rejected" });
});
