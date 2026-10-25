import pg from "pg";
import bcrypt from "bcryptjs";
import { config } from "../config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function initDb(): Promise<void> {
  console.log("[db] Initializing database schema...");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'member',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 2. Upstream Servers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS servers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(64) UNIQUE NOT NULL,
        url TEXT NOT NULL,
        auth_type VARCHAR(50) DEFAULT 'none',
        auth_token_encrypted TEXT,
        auth_header_name VARCHAR(100),
        enabled BOOLEAN DEFAULT true,
        health_status VARCHAR(50) DEFAULT 'Unknown',
        health_error TEXT,
        last_health_check TIMESTAMP WITH TIME ZONE,
        member_access BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 3. API Keys table
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        key_prefix VARCHAR(50) NOT NULL,
        key_hash VARCHAR(64) UNIQUE NOT NULL,
        revoked BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_used_at TIMESTAMP WITH TIME ZONE
      );
    `);

    // 4. Audit Log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        user_email VARCHAR(255),
        server_slug VARCHAR(64) NOT NULL,
        tool_name VARCHAR(255) NOT NULL,
        duration_ms INTEGER NOT NULL,
        outcome VARCHAR(50) NOT NULL,
        error_message TEXT,
        request_args_sanitized JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 5. Chat Sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL DEFAULT 'New Conversation',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 6. Chat Messages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        tool_calls JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Sync Admin User & Password from Secret on startup
    const passwordHash = await bcrypt.hash(config.adminPassword, 10);
    const adminExists = await client.query("SELECT id FROM users WHERE email = $1", [config.adminEmail]);
    if (adminExists.rowCount === 0) {
      await client.query(
        "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')",
        [config.adminEmail, passwordHash]
      );
      console.log(`[db] Seeded initial admin user: ${config.adminEmail}`);
    } else {
      await client.query(
        "UPDATE users SET password_hash = $1 WHERE email = $2",
        [passwordHash, config.adminEmail]
      );
      console.log(`[db] Synchronized admin password from environment secret.`);
    }

    // Seed Initial Upstream Servers (3 servers: woo, utils, everything)
    const initialServers = [
      {
        name: "WooCommerce Store",
        slug: "woo",
        url: "http://uai-woo-mcp:8000/mcp",
      },
      {
        name: "Utility Tools",
        slug: "utils",
        url: "http://uai-utils-mcp:8001/mcp",
      },
      {
        name: "Everything Demo",
        slug: "everything",
        url: "http://uai-everything-mcp:8002/mcp",
      },
    ];

    for (const s of initialServers) {
      const exists = await client.query("SELECT id FROM servers WHERE slug = $1", [s.slug]);
      if (exists.rowCount === 0) {
        await client.query(
          `INSERT INTO servers (name, slug, url, auth_type, enabled)
           VALUES ($1, $2, $3, 'none', true)`,
          [s.name, s.slug, s.url]
        );
        console.log(`[db] Seeded initial upstream server: ${s.name} (${s.slug})`);
      }
    }

    // Ensure member_access column exists on servers table
    await client.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS member_access BOOLEAN DEFAULT false;`);
    await client.query(`UPDATE servers SET member_access = true WHERE slug IN ('woo', 'utils', 'everything') AND member_access IS NOT TRUE;`);

    // Migrate any legacy /sse URLs to modern Streamable HTTP /mcp
    await client.query(`UPDATE servers SET url = REPLACE(url, '/sse', '/mcp') WHERE url LIKE '%/sse'`);

    await client.query("COMMIT");
    console.log("[db] Database schema initialized successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[db] Database initialization error:", err);
    throw err;
  } finally {
    client.release();
  }
}
