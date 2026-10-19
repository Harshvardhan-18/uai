import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/index.js";
import { authenticateRequest, requireAdmin, AuthenticatedRequest } from "../auth/auth-service.js";

export const userRouter = Router();

userRouter.use(authenticateRequest);
userRouter.use(requireAdmin);

// 1. GET /api/users - List team members
userRouter.get("/", async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.role, u.created_at,
             COUNT(k.id) as key_count
      FROM users u
      LEFT JOIN api_keys k ON u.id = k.user_id AND k.revoked = false
      GROUP BY u.id, u.email, u.role, u.created_at
      ORDER BY u.created_at ASC
    `);
    res.json({ users: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch users: ${err.message}` });
  }
});

// 2. POST /api/users - Invite/create team member
userRouter.post("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { email, password, role = "member" } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const validRole = role === "admin" ? "admin" : "member";

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id, email, role, created_at`,
      [email.toLowerCase().trim(), hash, validRole]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "A user with this email already exists" });
      return;
    }
    res.status(500).json({ error: `Failed to create user: ${err.message}` });
  }
});
