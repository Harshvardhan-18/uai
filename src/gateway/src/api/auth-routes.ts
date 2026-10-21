import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/index.js";
import { generateJwt, AuthenticatedRequest, authenticateRequest } from "../auth/auth-service.js";

export const authRouter = Router();

authRouter.post("/login", async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase().trim()]);
  if (result.rowCount === 0) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const userRow = result.rows[0];
  const valid = await bcrypt.compare(password, userRow.password_hash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const user = {
    id: userRow.id,
    email: userRow.email,
    role: userRow.role,
    created_at: userRow.created_at,
  };

  const token = generateJwt(user);

  res.cookie("uai_session", token, {
    httpOnly: true,
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/",
  });

  res.json({ user, token });
});

authRouter.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("uai_session", { path: "/" });
  res.json({ message: "Logged out successfully" });
});

authRouter.get("/me", authenticateRequest, (req: AuthenticatedRequest, res: Response) => {
  res.json({ user: req.user });
});
