import React, { useState } from 'react';
import { ApiKeyItem, User } from '../types';
import { Key, Plus, Copy, Check, AlertTriangle, Trash2, Terminal, Code, X, CheckCircle, XCircle } from 'lucide-react';

interface MyKeysTabProps {
  user: User;
  keys: ApiKeyItem[];
  onCreateKey: (name: string) => Promise<{ key: ApiKeyItem; rawApiKey: string; warning: string }>;
  onRevokeKey: (id: number) => Promise<void>;
}

export const MyKeysTab: React.FC<MyKeysTabProps> = ({ user, keys, onCreateKey, onRevokeKey }) => {
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeSnippet, setActiveSnippet] = useState<'cursor' | 'claude' | 'inspector'>('cursor');

  const myKeys = keys.filter((k) => !k.user_email || k.user_email === user.email);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    try {
      const res = await onCreateKey(keyName || 'CLI / IDE Key');
      setGeneratedKey(res.rawApiKey);
      setKeyName('');
    } catch (err: any) {
      alert(`Failed to create API key: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const cursorSnippet = `{
  "mcpServers": {
    "uai-gateway": {
      "url": "http://app.localtest.me/mcp",
      "headers": {
        "Authorization": "Bearer ${generatedKey || 'gw_YOUR_API_KEY_HERE'}"
      }
    }
  }
}`;

  const claudeSnippet = `claude mcp add uai-gateway -- \\
  http://app.localtest.me/mcp \\
  --header "Authorization: Bearer ${generatedKey || 'gw_YOUR_API_KEY_HERE'}"`;

  const inspectorSnippet = `npx @modelcontextprotocol/inspector http://app.localtest.me/mcp \\
  --header "Authorization: Bearer ${generatedKey || 'gw_YOUR_API_KEY_HERE'}"`;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Personal API Keys</h1>
          <p className="text-sm text-slate-500 mt-1">
            Authenticate external MCP clients (Claude Code, Cursor, MCP Inspector) with the UAI Gateway.
          </p>
        </div>

        <button
          onClick={() => {
            setKeyName('');
            setGeneratedKey(null);
            setShowGenerateModal(true);
          }}
          className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm self-start sm:self-auto"
        >
          <Plus className="w-4 h-4 mr-2" />
          <span>Generate New API Key</span>
        </button>
      </div>

      {/* Keys Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Key className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-semibold text-slate-900">Your Active Keys ({myKeys.length})</h2>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 font-semibold text-xs uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Key Name</th>
                <th className="px-6 py-3.5">Key Prefix</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5">Created</th>
                <th className="px-6 py-3.5">Last Used</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {myKeys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-400 italic">
                    No keys generated yet. Click "Generate New API Key" above to create one.
                  </td>
                </tr>
              ) : (
                myKeys.map((k) => (
                  <tr key={k.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-900">{k.name}</td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-600">{k.key_prefix}...</td>
                    <td className="px-6 py-4">
                      {k.revoked ? (
                        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          <XCircle className="w-3.5 h-3.5 mr-1 text-slate-400" />
                          Revoked
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                          <CheckCircle className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {new Date(k.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {!k.revoked && (
                        <button
                          onClick={() => {
                            if (confirm(`Revoke key "${k.name}"? Any MCP client using this key will be disconnected immediately.`)) {
                              onRevokeKey(k.id);
                            }
                          }}
                          className="inline-flex items-center text-xs font-medium text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-2.5 py-1 rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          <span>Revoke</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Integration Instructions Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center space-x-2">
          <Terminal className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-semibold text-slate-900">How to Connect External MCP Clients</h2>
        </div>
        <p className="text-sm text-slate-600">
          The UAI Gateway exposes Streamable HTTP SSE at <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono text-indigo-700">http://app.localtest.me/mcp</code>. Pass your API key via the <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono text-slate-700">Authorization: Bearer &lt;key&gt;</code> header.
        </p>

        {/* Snippet selector tabs */}
        <div className="flex space-x-2 border-b border-slate-200 pb-2">
          <button
            onClick={() => setActiveSnippet('cursor')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeSnippet === 'cursor'
                ? 'bg-indigo-50 text-indigo-700 font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Cursor IDE (mcp.json)
          </button>
          <button
            onClick={() => setActiveSnippet('claude')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeSnippet === 'claude'
                ? 'bg-indigo-50 text-indigo-700 font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Claude Code CLI
          </button>
          <button
            onClick={() => setActiveSnippet('inspector')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeSnippet === 'inspector'
                ? 'bg-indigo-50 text-indigo-700 font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            MCP Inspector
          </button>
        </div>

        {/* Code Box */}
        <div className="relative">
          <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
            {activeSnippet === 'cursor' && cursorSnippet}
            {activeSnippet === 'claude' && claudeSnippet}
            {activeSnippet === 'inspector' && inspectorSnippet}
          </pre>
          <button
            onClick={() =>
              copyToClipboard(
                activeSnippet === 'cursor'
                  ? cursorSnippet
                  : activeSnippet === 'claude'
                  ? claudeSnippet
                  : inspectorSnippet
              )
            }
            className="absolute top-3 right-3 p-1.5 rounded bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Copy snippet"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Generate Key Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">
                {generatedKey ? 'API Key Generated' : 'Generate New API Key'}
              </h3>
              <button onClick={() => setShowGenerateModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!generatedKey ? (
              <form onSubmit={handleGenerate} className="space-y-4 mt-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Key Description / Name</label>
                  <input
                    type="text"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="e.g. Cursor IDE Laptop"
                    required
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600"
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowGenerateModal(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={generating}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
                  >
                    {generating ? 'Generating...' : 'Generate Key'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4 mt-4">
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start space-x-3">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <div className="font-bold">Save this key now!</div>
                    <div>
                      For security, only the SHA-256 hash is stored. This raw key will <strong>never</strong> be shown again.
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Your Raw API Key</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedKey}
                      className="w-full font-mono text-xs px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 select-all"
                    />
                    <button
                      onClick={() => copyToClipboard(generatedKey)}
                      className="px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center space-x-1.5 text-xs font-medium"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4 text-emerald-300" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={() => setShowGenerateModal(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                  >
                    Done & Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
