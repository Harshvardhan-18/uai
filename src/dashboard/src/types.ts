export interface User {
  id: number;
  email: string;
  role: 'admin' | 'member';
  created_at: string;
}

export interface UpstreamServer {
  id: number;
  name: string;
  slug: string;
  url: string;
  auth_type: 'none' | 'bearer' | 'custom_header';
  auth_header_name?: string | null;
  enabled: boolean;
  health_status: 'Connected' | 'Unreachable' | 'Disabled';
  health_error?: string | null;
  last_health_check?: string | null;
  member_access?: boolean;
  created_at: string;
  updated_at?: string | null;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema?: any;
}

export interface ApiKeyItem {
  id: number;
  name: string;
  key_prefix: string;
  revoked: boolean;
  created_at: string;
  last_used_at?: string | null;
  user_email?: string;
}

export interface AuditLogItem {
  id: number;
  user_id?: number | null;
  user_email?: string | null;
  server_slug: string;
  tool_name: string;
  duration_ms: number;
  outcome: 'success' | 'error' | 'timeout' | 'rejected';
  error_message?: string | null;
  request_args_sanitized?: any;
  created_at: string;
}

export interface TeamMember {
  id: number;
  email: string;
  role: 'admin' | 'member';
  created_at: string;
  key_count: string | number;
}
