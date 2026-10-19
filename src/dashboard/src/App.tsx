import React, { useState, useEffect } from 'react';
import { User, UpstreamServer, McpTool, ApiKeyItem, AuditLogItem, TeamMember } from './types';
import { api, clearToken } from './api';
import { Navbar } from './components/Navbar';
import { LoginView } from './components/LoginView';
import { ServersTab } from './components/ServersTab';
import { TeamKeysTab } from './components/TeamKeysTab';
import { MyKeysTab } from './components/MyKeysTab';
import { AuditTab } from './components/AuditTab';
import { ChatTab } from './components/ChatTab';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState<string>('servers');

  // Application data
  const [servers, setServers] = useState<UpstreamServer[]>([]);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);

  // Restore session on mount
  useEffect(() => {
    async function initSession() {
      try {
        const { user } = await api.getMe();
        setUser(user);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    }
    initSession();
  }, []);

  // Fetch data whenever user is authenticated
  const loadData = async () => {
    if (!user) return;
    try {
      const [serversRes, toolsRes, keysRes] = await Promise.all([
        api.getServers().catch(() => ({ servers: [] })),
        api.getTools().catch(() => ({ tools: [] })),
        api.getKeys().catch(() => ({ keys: [] })),
      ]);
      setServers(serversRes.servers);
      setTools(toolsRes.tools);
      setKeys(keysRes.keys);

      if (user.role === 'admin') {
        const [usersRes, auditRes] = await Promise.all([
          api.getUsers().catch(() => ({ users: [] })),
          api.getAuditLogs({ limit: 50 }).catch(() => ({ logs: [], total: 0 })),
        ]);
        setMembers(usersRes.users);
        setAuditLogs(auditRes.logs);
        setAuditTotal(auditRes.total);
      } else {
        const auditRes = await api.getAuditLogs({ limit: 50 }).catch(() => ({ logs: [], total: 0 }));
        setAuditLogs(auditRes.logs);
        setAuditTotal(auditRes.total);
      }
    } catch (err) {
      console.error('Failed to load application data:', err);
    }
  };

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    } finally {
      clearToken();
      setUser(null);
    }
  };

  // Server actions
  const handleCreateServer = async (data: any) => {
    await api.createServer(data);
    await loadData();
  };

  const handleUpdateServer = async (id: number, data: any) => {
    await api.updateServer(id, data);
    await loadData();
  };

  const handleToggleServer = async (id: number) => {
    await api.toggleServer(id);
    await loadData();
  };

  const handleDeleteServer = async (id: number) => {
    await api.deleteServer(id);
    await loadData();
  };

  // Key actions
  const handleCreateKey = async (name: string) => {
    const res = await api.createKey(name);
    await loadData();
    return res;
  };

  const handleRevokeKey = async (id: number) => {
    await api.revokeKey(id);
    await loadData();
  };

  // Team actions
  const handleAddMember = async (data: any) => {
    await api.createUser(data);
    await loadData();
  };

  // Audit filter
  const handleAuditFilterChange = async (filters: { server?: string; outcome?: string; user_email?: string }) => {
    const res = await api.getAuditLogs({ ...filters, limit: 50 });
    setAuditLogs(res.logs);
    setAuditTotal(res.total);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Connecting to UAI Gateway...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginView onLoginSuccess={(u) => setUser(u)} onLogin={api.login} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Navbar
        user={user}
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        onLogout={handleLogout}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentTab === 'servers' && (
          <ServersTab
            servers={servers}
            tools={tools}
            user={user}
            onRefresh={loadData}
            onCreateServer={handleCreateServer}
            onUpdateServer={handleUpdateServer}
            onToggleServer={handleToggleServer}
            onDeleteServer={handleDeleteServer}
          />
        )}

        {currentTab === 'team' && user.role === 'admin' && (
          <TeamKeysTab
            user={user}
            members={members}
            allKeys={keys}
            onAddMember={handleAddMember}
            onRevokeKey={handleRevokeKey}
            onRefresh={loadData}
          />
        )}

        {currentTab === 'my-keys' && (
          <MyKeysTab
            user={user}
            keys={keys}
            onCreateKey={handleCreateKey}
            onRevokeKey={handleRevokeKey}
          />
        )}

        {currentTab === 'audit' && (
          <AuditTab
            logs={auditLogs}
            total={auditTotal}
            servers={servers}
            user={user}
            onFilterChange={handleAuditFilterChange}
            onRefresh={loadData}
          />
        )}

        {currentTab === 'chat' && (
          <ChatTab user={user} tools={tools} />
        )}
      </main>
    </div>
  );
}

export default App;
