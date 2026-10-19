import { Router, Response } from "express";
import { pool } from "../db/index.js";
import { generateApiKey } from "../crypto/encryption.js";
import { authenticateRequest, AuthenticatedRequest } from "../auth/auth-service.js";
import { ApiKey } from "../types/index.js";

export const keyRouter = Router();

keyRouter.use(authenticateRequest);

// 1. GET /api/keys - List API keys (prefix only, never raw key or hash)
keyRouter.get("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user!;
  let query = `
    SELECT k.id, k.name, k.key_prefix, k.revoked, k.created_at, k.last_used_at, u.email as user_email
    FROM api_keys k
    JOIN users u ON k.user_id = u.id
  `;
  const params: any[] = [];

  // Members only see their own keys; Admins see all keys
  if (user.role !== "admin") {
    query += " WHERE k.user_id = $1";
    params.push(user.id);
  }

  query += " ORDER BY k.created_at DESC";
  const result = await pool.query(query, params);
  res.json({ keys: result.rows });
});

// 2. POST /api/keys - Create a new API key (returns raw key once!)
keyRouter.post("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const { name = "Default API Key" } = req.body;

  const { rawKey, keyPrefix, keyHash } = generateApiKey();

  try {
    const result = await pool.query<ApiKey>(
      `INSERT INTO api_keys (user_id, name, key_prefix, key_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, key_prefix, revoked, created_at`,
      [user.id, name, keyPrefix, keyHash]
    );

    res.status(201).json({
      key: result.rows[0],
      rawApiKey: rawKey, // Shown once to user
      warning: "Save this key now. It will never be shown again.",
    });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to create API key: ${err.message}` });
  }
});

// 3. DELETE /api/keys/:id - Revoke an API key immediately
keyRouter.delete("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const keyId = parseInt(req.params.id as string, 10);

  try {
    let checkQuery = "SELECT id, user_id FROM api_keys WHERE id = $1";
    const checkRes = await pool.query(checkQuery, [keyId]);
    if (checkRes.rowCount === 0) {
      res.status(404).json({ error: "API key not found" });
      return;
    }

    const row = checkRes.rows[0];
    if (user.role !== "admin" && row.user_id !== user.id) {
      res.status(403).json({ error: "You can only revoke your own API keys" });
      return;
    }

    await pool.query("UPDATE api_keys SET revoked = true WHERE id = $1", [keyId]);
    res.json({ message: "API key revoked successfully. Any subsequent calls with this key will fail immediately." });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to revoke API key: ${err.message}` });
  }
});
