import { User, UpstreamServer, McpTool, ApiKeyItem, AuditLogItem, TeamMember } from "./types";

const TOKEN_KEY = "uai_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
    credentials: "include",
  });

  if (res.status === 401 && !endpoint.includes("/api/auth/login")) {
    clearToken();
    window.location.hash = "#/login";
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }

  return data as T;
}

export const api = {
  // Auth
  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    const data = await request<{ user: User; token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    return data;
  },

  async logout(): Promise<void> {
    try {
      await request("/api/auth/logout", { method: "POST" });
    } finally {
      clearToken();
    }
  },

  async getMe(): Promise<{ user: User }> {
    return request<{ user: User }>("/api/auth/me");
  },

  // Servers
  async getServers(): Promise<{ servers: UpstreamServer[] }> {
    return request<{ servers: UpstreamServer[] }>("/api/servers");
  },

  async getTools(): Promise<{ tools: McpTool[] }> {
    return request<{ tools: McpTool[] }>("/api/servers/tools");
  },

  async createServer(serverData: {
    name: string;
    slug: string;
    url: string;
    auth_type: string;
    auth_token?: string;
    auth_header_name?: string;
  }): Promise<{ server: UpstreamServer }> {
    return request<{ server: UpstreamServer }>("/api/servers", {
      method: "POST",
      body: JSON.stringify(serverData),
    });
  },

  async updateServer(
    id: number,
    serverData: {
      name?: string;
      url?: string;
      auth_type?: string;
      auth_token?: string;
      auth_header_name?: string;
      enabled?: boolean;
    }
  ): Promise<{ server: UpstreamServer }> {
    return request<{ server: UpstreamServer }>(`/api/servers/${id}`, {
      method: "PUT",
      body: JSON.stringify(serverData),
    });
  },

  async toggleServer(id: number): Promise<{ server: UpstreamServer }> {
    return request<{ server: UpstreamServer }>(`/api/servers/${id}/toggle`, {
      method: "POST",
    });
  },

  async deleteServer(id: number): Promise<{ message: string }> {
    return request<{ message: string }>(`/api/servers/${id}`, {
      method: "DELETE",
    });
  },

  // API Keys
  async getKeys(): Promise<{ keys: ApiKeyItem[] }> {
    return request<{ keys: ApiKeyItem[] }>("/api/keys");
  },

  async createKey(name: string): Promise<{ key: ApiKeyItem; rawApiKey: string; warning: string }> {
    return request<{ key: ApiKeyItem; rawApiKey: string; warning: string }>("/api/keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },

  async revokeKey(id: number): Promise<{ message: string }> {
    return request<{ message: string }>(`/api/keys/${id}`, {
      method: "DELETE",
    });
  },

  // Audit Logs
  async getAuditLogs(params: {
    server?: string;
    outcome?: string;
    user_email?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AuditLogItem[]; total: number; limit: number; offset: number }> {
    const searchParams = new URLSearchParams();
    if (params.server) searchParams.set("server", params.server);
    if (params.outcome && params.outcome !== "all") searchParams.set("outcome", params.outcome);
    if (params.user_email) searchParams.set("user_email", params.user_email);
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.offset) searchParams.set("offset", String(params.offset));

    return request(`/api/audit?${searchParams.toString()}`);
  },

  // Team & Users
  async getUsers(): Promise<{ users: TeamMember[] }> {
    return request<{ users: TeamMember[] }>("/api/users");
  },

  async createUser(userData: {
    email: string;
    password: string;
    role: "admin" | "member";
  }): Promise<{ user: User }> {
    return request<{ user: User }>("/api/users", {
      method: "POST",
      body: JSON.stringify(userData),
    });
  },
};
