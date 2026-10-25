import React, { useState } from 'react';
import { UpstreamServer, McpTool, User } from '../types';
import { 
  Server, Plus, RefreshCw, CheckCircle2, AlertTriangle, 
  XCircle, Power, Edit3, Trash2, ChevronDown, ChevronRight,
  Shield, Code, ExternalLink, X, Lock
} from 'lucide-react';

interface ServersTabProps {
  servers: UpstreamServer[];
  tools: McpTool[];
  user: User;
  onRefresh: () => Promise<void>;
  onCreateServer: (data: any) => Promise<void>;
  onUpdateServer: (id: number, data: any) => Promise<void>;
  onToggleServer: (id: number) => Promise<void>;
  onDeleteServer: (id: number) => Promise<void>;
}

export const ServersTab: React.FC<ServersTabProps> = ({
  servers,
  tools,
  user,
  onRefresh,
  onCreateServer,
  onUpdateServer,
  onToggleServer,
  onDeleteServer,
}) => {
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingServer, setEditingServer] = useState<UpstreamServer | null>(null);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<McpTool | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [url, setUrl] = useState('');
  const [authType, setAuthType] = useState<'none' | 'bearer' | 'custom_header'>('none');
  const [authToken, setAuthToken] = useState('');
  const [authHeaderName, setAuthHeaderName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const openAddModal = () => {
    setName('');
    setSlug('');
    setUrl('');
    setAuthType('none');
    setAuthToken('');
    setAuthHeaderName('');
    setFormError(null);
    setShowAddModal(true);
  };

  const openEditModal = (server: UpstreamServer) => {
    setEditingServer(server);
    setName(server.name);
    setSlug(server.slug);
    setUrl(server.url);
    setAuthType(server.auth_type);
    setAuthToken(''); // Never prefilled (security rule)
    setAuthHeaderName(server.auth_header_name || '');
    setFormError(null);
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!editingServer) {
      // Auto-generate slug
      const generated = val.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
      setSlug(generated);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      if (editingServer) {
        await onUpdateServer(editingServer.id, {
          name,
          url,
          auth_type: authType,
          auth_token: authToken ? authToken : undefined,
          auth_header_name: authHeaderName || undefined,
        });
        setEditingServer(null);
      } else {
        await onCreateServer({
          name,
          slug,
          url,
          auth_type: authType,
          auth_token: authToken || undefined,
          auth_header_name: authHeaderName || undefined,
        });
        setShowAddModal(false);
      }
    } catch (err: any) {
      setFormError(err.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const connectedCount = servers.filter((s) => s.health_status === 'Connected' && s.enabled).length;

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Upstream MCP Servers</h1>
          <p className="text-sm text-slate-500 mt-1">
            Registered upstream MCP servers exposing tools aggregated by the gateway.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="hidden sm:inline-flex items-center px-2.5 py-1.5 rounded-full text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-1.5"></span>
            Auto-polling: 4s
          </div>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center px-3.5 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin text-indigo-600' : 'text-slate-400'}`} />
            <span>Refresh</span>
          </button>

          {user.role === 'admin' && (
            <button
              onClick={openAddModal}
              className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              <span>Add Upstream Server</span>
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center space-x-4">
          <div className="w-12 h-12 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
            <Server className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900">{servers.length}</div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Servers</div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center space-x-4">
          <div className="w-12 h-12 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900">{connectedCount} / {servers.length}</div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Connected & Healthy</div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center space-x-4">
          <div className="w-12 h-12 rounded-lg bg-violet-50 flex items-center justify-center text-violet-600">
            <Code className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900">{tools.length}</div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Aggregated Tools</div>
          </div>
        </div>
      </div>

      {/* Servers List */}
      <div className="space-y-4">
        {servers.map((server) => {
          const isExpanded = expandedServer === server.slug;
          const serverTools = tools.filter((t) => t.name.startsWith(`${server.slug}__`));

          return (
            <div
              key={server.id}
              className={`bg-white rounded-xl border transition-all shadow-sm ${
                !server.enabled
                  ? 'border-slate-200 opacity-75'
                  : server.health_status === 'Connected'
                  ? 'border-slate-200 hover:border-indigo-200'
                  : 'border-rose-200 bg-rose-50/20'
              }`}
            >
              {/* Server Card Header */}
              <div className="p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-start space-x-4">
                  <div
                    className={`mt-1 w-3 h-3 rounded-full flex-shrink-0 ${
                      !server.enabled
                        ? 'bg-slate-300'
                        : server.health_status === 'Connected'
                        ? 'bg-emerald-500 ring-4 ring-emerald-100'
                        : 'bg-rose-500 ring-4 ring-rose-100'
                    }`}
                  />
                  <div>
                    <div className="flex items-center space-x-2 flex-wrap">
                      <h3 className="text-base font-semibold text-slate-900">{server.name}</h3>
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                        {server.slug}
                      </span>
                      {server.auth_type !== 'none' && (
                        <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                          <Lock className="w-3 h-3 mr-1" />
                          {server.auth_type === 'bearer' ? 'Bearer Auth' : server.auth_header_name}
                        </span>
                      )}
                      {server.member_access ? (
                        <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                          Members: Allowed
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                          Admin Only
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 mt-1 text-xs text-slate-500 font-mono">
                      <span>{server.url}</span>
                    </div>

                    {/* Health Status & Error message if unreachable */}
                    <div className="mt-2 flex items-center space-x-2">
                      <span
                        className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                          !server.enabled
                            ? 'bg-slate-100 text-slate-600'
                            : server.health_status === 'Connected'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {!server.enabled ? 'Disabled' : server.health_status}
                      </span>
                      {server.health_error && (
                        <span className="text-xs text-rose-600 font-medium">
                          ({server.health_error})
                        </span>
                      )}
                      {server.last_health_check && (
                        <span className="text-[11px] text-slate-400">
                          Checked: {new Date(server.last_health_check).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right side controls */}
                <div className="flex items-center space-x-2 self-end md:self-center">
                  <button
                    onClick={() => setExpandedServer(isExpanded ? null : server.slug)}
                    className="inline-flex items-center px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <span>{serverTools.length} Tools</span>
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 ml-1.5 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 ml-1.5 text-slate-500" />
                    )}
                  </button>

                  {user.role === 'admin' && (
                    <>
                      <button
                        onClick={async () => {
                          const token = localStorage.getItem('uai_token');
                          await fetch(`/api/servers/${server.id}/permissions`, {
                            method: 'PATCH',
                            headers: {
                              'Content-Type': 'application/json',
                              ...(token ? { Authorization: `Bearer ${token}` } : {}),
                            },
                            credentials: 'include',
                            body: JSON.stringify({ member_access: !server.member_access }),
                          });
                          await onRefresh();
                        }}
                        title={server.member_access ? 'Restrict to Admin only' : 'Allow Member access'}
                        className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1 ${
                          server.member_access
                            ? 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100'
                            : 'text-purple-700 bg-purple-50 border-purple-200 hover:bg-purple-100'
                        }`}
                      >
                        <Shield className="w-3.5 h-3.5" />
                        {server.member_access ? 'Member Access' : 'Admin Only'}
                      </button>

                      <button
                        onClick={() => onToggleServer(server.id)}
                        title={server.enabled ? 'Disable Server' : 'Enable Server'}
                        className={`p-2 rounded-lg transition-colors border ${
                          server.enabled
                            ? 'text-emerald-600 hover:bg-emerald-50 border-slate-200'
                            : 'text-slate-400 hover:bg-slate-100 border-slate-200'
                        }`}
                      >
                        <Power className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => openEditModal(server)}
                        title="Edit Server"
                        className="p-2 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200 rounded-lg transition-colors"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => {
                          if (confirm(`Remove server "${server.name}"?`)) {
                            onDeleteServer(server.id);
                          }
                        }}
                        title="Delete Server"
                        className="p-2 text-slate-600 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Collapsible Tools List */}
              {isExpanded && (
                <div className="border-t border-slate-100 bg-slate-50/70 p-5 rounded-b-xl">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    Exposed Tools from {server.name} ({serverTools.length})
                  </div>
                  {serverTools.length === 0 ? (
                    <p className="text-sm text-slate-400 italic">No tools discovered or server is unreachable.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {serverTools.map((tool) => (
                        <div
                          key={tool.name}
                          onClick={() => setSelectedTool(tool)}
                          className="p-3 bg-white rounded-lg border border-slate-200 hover:border-indigo-300 hover:shadow-xs transition-all cursor-pointer"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                              {tool.name}
                            </span>
                            <span className="text-[11px] text-slate-400 flex items-center hover:text-indigo-600">
                              View Schema <ExternalLink className="w-3 h-3 ml-1" />
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-2 line-clamp-2">
                            {tool.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add / Edit Server Modal */}
      {(showAddModal || editingServer) && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">
                {editingServer ? 'Edit Upstream Server' : 'Add Upstream MCP Server'}
              </h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingServer(null);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Server Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Weather Service"
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600"
                />
              </div>

              {!editingServer && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Slug (Prefix for namespacing)
                  </label>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                    placeholder="e.g. weather"
                    required
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Tools will be exposed as <span className="font-mono">{slug || '<slug>'}__&lt;toolName&gt;</span>
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  SSE Endpoint URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://uai-service:8080/sse"
                  required
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Auth Type</label>
                  <select
                    value={authType}
                    onChange={(e: any) => setAuthType(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600"
                  >
                    <option value="none">None (Public/ClusterIP)</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="custom_header">Custom Header</option>
                  </select>
                </div>

                {authType === 'custom_header' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Header Name</label>
                    <input
                      type="text"
                      value={authHeaderName}
                      onChange={(e) => setAuthHeaderName(e.target.value)}
                      placeholder="X-API-Key"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600"
                    />
                  </div>
                )}
              </div>

              {authType !== 'none' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {editingServer ? 'New Auth Token / Secret (leave empty to keep existing)' : 'Auth Token / Secret'}
                  </label>
                  <input
                    type="password"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    placeholder="••••••••••••••••"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600"
                  />
                  <p className="text-[11px] text-amber-600 mt-1 flex items-center">
                    <Shield className="w-3.5 h-3.5 mr-1 flex-shrink-0" />
                    Encrypted with AES-256-GCM at rest. Never returned by any API.
                  </p>
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingServer(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingServer ? 'Update Server' : 'Add Server'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tool Schema Details Modal */}
      {selectedTool && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div>
                <span className="font-mono text-sm font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded">
                  {selectedTool.name}
                </span>
              </div>
              <button onClick={() => setSelectedTool(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 overflow-y-auto space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Description</h4>
                <p className="text-sm text-slate-700">{selectedTool.description}</p>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Input Schema (JSON Schema)</h4>
                <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto">
                  {JSON.stringify(selectedTool.inputSchema || {}, null, 2)}
                </pre>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setSelectedTool(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
