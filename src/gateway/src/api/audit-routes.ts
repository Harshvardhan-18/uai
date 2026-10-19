import { Router, Response } from "express";
import { pool } from "../db/index.js";
import { authenticateRequest, AuthenticatedRequest } from "../auth/auth-service.js";
import { AuditLogEntry } from "../types/index.js";

export const auditRouter = Router();

auditRouter.use(authenticateRequest);

// GET /api/audit - List audit logs with filters
auditRouter.get("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const { server, outcome, user_email, limit = 50, offset = 0 } = req.query;

  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  // Members only view their own logs; Admins can view all
  if (user.role !== "admin") {
    conditions.push(`user_id = $${paramIdx++}`);
    params.push(user.id);
  } else if (user_email) {
    conditions.push(`user_email ILIKE $${paramIdx++}`);
    params.push(`%${user_email}%`);
  }

  if (server) {
    conditions.push(`server_slug = $${paramIdx++}`);
    params.push(server);
  }

  if (outcome) {
    conditions.push(`outcome = $${paramIdx++}`);
    params.push(outcome);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const totalResult = await pool.query(`SELECT COUNT(*) FROM audit_logs ${whereClause}`, params);
    const total = parseInt(totalResult.rows[0].count, 10);

    const query = `
      SELECT id, user_id, user_email, server_slug, tool_name, duration_ms, outcome,
             error_message, request_args_sanitized, created_at
      FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    params.push(parseInt(String(limit), 10), parseInt(String(offset), 10));

    const result = await pool.query<AuditLogEntry>(query, params);
    res.json({
      logs: result.rows,
      total,
      limit: parseInt(String(limit), 10),
      offset: parseInt(String(offset), 10),
    });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch audit logs: ${err.message}` });
  }
});
