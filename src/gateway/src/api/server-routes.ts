import { Router, Response } from "express";
import { pool } from "../db/index.js";
import { encrypt } from "../crypto/encryption.js";
import { authenticateRequest, requireAdmin, AuthenticatedRequest } from "../auth/auth-service.js";
import { upstreamPool } from "../upstream/client-pool.js";
import { healthChecker } from "../upstream/health-checker.js";
import { UpstreamServer } from "../types/index.js";
import { canUserAccessTool, setMemberAllowedServers, allowServerForMembers, disallowServerForMembers } from "../auth/permissions.js";
import { validateUpstreamUrl } from "../crypto/ssrf-guard.js";

export const serverRouter = Router();

// Apply auth to all server routes
serverRouter.use(authenticateRequest);

// Helper to keep memberAllowedServerSlugs in sync with DB
async function syncMemberAllowedServers(): Promise<void> {
  try {
    const res = await pool.query<{ slug: string }>("SELECT slug FROM servers WHERE member_access = true AND enabled = true");
    setMemberAllowedServers(res.rows.map((r) => r.slug));
  } catch {}
}

// 1. GET /api/servers - List all upstream servers (credentials stripped)
serverRouter.get("/", async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  await syncMemberAllowedServers();
  const result = await pool.query<UpstreamServer>(`
    SELECT id, name, slug, url, auth_type, auth_header_name, enabled,
           health_status, health_error, last_health_check, member_access, created_at, updated_at
    FROM servers
    ORDER BY id ASC
  `);
  res.json({ servers: result.rows });
});

// 2. GET /api/servers/tools - List all aggregated tools currently available (role-filtered)
serverRouter.get("/tools", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await syncMemberAllowedServers();
    const user = req.user!;
    const tools = await upstreamPool.listAggregatedTools();
    const visibleTools = tools.filter((t) => canUserAccessTool(user, t.name));
    res.json({ tools: visibleTools });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to list aggregated tools: ${err.message}` });
  }
});

// 3. POST /api/servers - Add a new upstream server (admin only, SSRF guarded, defaults to admin-only)
serverRouter.post("/", requireAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { name, slug, url, auth_type = "none", auth_token, auth_header_name, member_access = false } = req.body;

  if (!name || !slug || !url) {
    res.status(400).json({ error: "name, slug, and url are required" });
    return;
  }

  // SSRF Protection
  const ssrfCheck = await validateUpstreamUrl(url);
  if (!ssrfCheck.valid) {
    res.status(400).json({ error: `SSRF validation failed: ${ssrfCheck.reason}` });
    return;
  }

  // Validate slug format
  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!cleanSlug) {
    res.status(400).json({ error: "Invalid slug. Must contain only alphanumeric characters, dashes, or underscores." });
    return;
  }

  // Encrypt token if provided
  const encryptedToken = auth_token ? encrypt(auth_token) : null;

  try {
    const result = await pool.query(
      `INSERT INTO servers (name, slug, url, auth_type, auth_token_encrypted, auth_header_name, member_access, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING id, name, slug, url, auth_type, auth_header_name, member_access, enabled, health_status, created_at`,
      [name, cleanSlug, url, auth_type, encryptedToken, auth_header_name || null, member_access === true]
    );

    if (member_access === true) {
      allowServerForMembers(cleanSlug);
    } else {
      disallowServerForMembers(cleanSlug);
    }

    upstreamPool.invalidateCache();
    // Run immediate health check in background
    healthChecker.checkAll().catch(() => {});

    res.status(201).json({ server: result.rows[0] });
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: `A server with slug "${cleanSlug}" already exists.` });
      return;
    }
    res.status(500).json({ error: `Failed to create server: ${err.message}` });
  }
});

// 4. PUT /api/servers/:id - Update an upstream server (admin only)
serverRouter.put("/:id", requireAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const { name, url, auth_type, auth_token, auth_header_name, enabled } = req.body;

  try {
    const existing = await pool.query("SELECT * FROM servers WHERE id = $1", [id]);
    if (existing.rowCount === 0) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    const current = existing.rows[0];

    // SSRF Check if URL is being updated
    if (url) {
      const ssrfCheck = await validateUpstreamUrl(url);
      if (!ssrfCheck.valid) {
        res.status(400).json({ error: `SSRF validation failed: ${ssrfCheck.reason}` });
        return;
      }
    }

    const newEncryptedToken = auth_token ? encrypt(auth_token) : current.auth_token_encrypted;

    const result = await pool.query(
      `UPDATE servers
       SET name = COALESCE($1, name),
           url = COALESCE($2, url),
           auth_type = COALESCE($3, auth_type),
           auth_token_encrypted = $4,
           auth_header_name = COALESCE($5, auth_header_name),
           enabled = COALESCE($6, enabled),
           updated_at = NOW()
       WHERE id = $7
       RETURNING id, name, slug, url, auth_type, auth_header_name, enabled, health_status, updated_at`,
      [name, url, auth_type, newEncryptedToken, auth_header_name, enabled, id]
    );

    upstreamPool.invalidateCache();
    res.json({ server: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to update server: ${err.message}` });
  }
});

// 5. POST /api/servers/:id/toggle - Toggle server enabled/disabled
serverRouter.post("/:id/toggle", requireAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  try {
    const result = await pool.query(
      `UPDATE servers 
       SET enabled = NOT enabled, updated_at = NOW() 
       WHERE id = $1 
       RETURNING id, name, slug, enabled, health_status`,
      [id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    upstreamPool.invalidateCache();
    healthChecker.checkAll().catch(() => {});
    res.json({ server: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to toggle server: ${err.message}` });
  }
});

// 6. PATCH /api/servers/:id/permissions - Allow or restrict member access to server's tools (admin only)
serverRouter.patch("/:id/permissions", requireAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const { member_access } = req.body;

  try {
    const result = await pool.query(
      `UPDATE servers 
       SET member_access = $1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING id, name, slug, member_access, enabled`,
      [member_access === true, id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    const row = result.rows[0];
    if (row.member_access) {
      allowServerForMembers(row.slug);
    } else {
      disallowServerForMembers(row.slug);
    }

    upstreamPool.invalidateCache();
    res.json({ server: row });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to update permissions: ${err.message}` });
  }
});

// 7. DELETE /api/servers/:id - Delete an upstream server (admin only)
serverRouter.delete("/:id", requireAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  try {
    const result = await pool.query("DELETE FROM servers WHERE id = $1 RETURNING slug", [id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    const slug = result.rows[0].slug;
    disallowServerForMembers(slug);
    upstreamPool.invalidateCache();
    res.json({ message: "Server removed successfully" });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to delete server: ${err.message}` });
  }
});

// 7. POST /api/servers/check-health - Trigger immediate health check across all upstreams
serverRouter.post("/check-health", requireAdmin, async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await healthChecker.checkAll();
    const result = await pool.query<UpstreamServer>(`
      SELECT id, name, slug, url, auth_type, auth_header_name, enabled,
             health_status, health_error, last_health_check, created_at, updated_at
      FROM servers
      ORDER BY id ASC
    `);
    res.json({ servers: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to trigger health check: ${err.message}` });
  }
});

