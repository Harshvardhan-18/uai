import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { pool } from "../db/index.js";
import { sha256 } from "../crypto/encryption.js";
import { User } from "../types/index.js";

export interface AuthenticatedRequest extends Request {
  user?: User;
  apiKeyId?: number;
}

export function generateJwt(user: User): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: "7d" }
  );
}

export function verifyJwt(token: string): User | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as any;
    return {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      created_at: "",
    };
  } catch {
    return null;
  }
}

/**
 * Middleware: authenticates requests using either:
 * 1. httpOnly session cookie ("uai_session")
 * 2. Bearer API key (`Authorization: Bearer gw_...`)
 * 3. Bearer JWT (`Authorization: Bearer <jwt>`)
 */
export async function authenticateRequest(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const sessionCookie = req.cookies?.uai_session;

  // 1. Check Bearer API Key (gw_...)
  if (authHeader && authHeader.startsWith("Bearer gw_")) {
    const rawKey = authHeader.substring(7).trim();
    const keyHash = sha256(rawKey);

    const result = await pool.query(
      `SELECT k.id as key_id, k.revoked, u.id as user_id, u.email, u.role, u.created_at
       FROM api_keys k
       JOIN users u ON k.user_id = u.id
       WHERE k.key_hash = $1`,
      [keyHash]
    );

    if (result.rowCount === 0) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    const row = result.rows[0];
    if (row.revoked) {
      res.status(401).json({ error: "API key has been revoked" });
      return;
    }

    // Update last_used_at asynchronously
    pool.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [row.key_id]).catch(() => {});

    req.user = {
      id: row.user_id,
      email: row.email,
      role: row.role,
      created_at: row.created_at,
    };
    req.apiKeyId = row.key_id;
    next();
    return;
  }

  // 2. Check Bearer JWT token
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    const user = verifyJwt(token);
    if (user) {
      req.user = user;
      next();
      return;
    }
  }

  // 3. Check Session Cookie
  if (sessionCookie) {
    const user = verifyJwt(sessionCookie);
    if (user) {
      req.user = user;
      next();
      return;
    }
  }

  res.status(401).json({ error: "Unauthorized. Valid session cookie or API key required." });
}

export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Forbidden: Admin privilege required." });
    return;
  }
  next();
}
