export type UserRole = "admin" | "member";

export interface User {
  id: number;
  email: string;
  role: UserRole;
  created_at: string;
}

export type HealthStatus = "Connected" | "Unreachable" | "Disabled" | "Unknown";

export interface UpstreamServer {
  id: number;
  name: string;
  slug: string;
  url: string;
  auth_type: "none" | "bearer" | "header";
  auth_token_encrypted?: string | null;
  auth_header_name?: string | null;
  enabled: boolean;
  health_status: HealthStatus;
  health_error?: string | null;
  last_health_check?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: number;
  user_id: number;
  name: string;
  key_prefix: string;
  key_hash: string;
  revoked: boolean;
  created_at: string;
  last_used_at?: string | null;
}

export interface AuditLogEntry {
  id: number;
  user_id?: number | null;
  user_email?: string | null;
  server_slug: string;
  tool_name: string;
  duration_ms: number;
  outcome: "success" | "error" | "timeout";
  error_message?: string | null;
  request_args_sanitized?: any;
  created_at: string;
}

export interface AggregatedTool {
  name: string; // e.g. "woo__list_products"
  originalName: string; // e.g. "list_products"
  serverSlug: string; // e.g. "woo"
  serverName: string; // e.g. "WooCommerce Store"
  description: string;
  inputSchema: any;
}
