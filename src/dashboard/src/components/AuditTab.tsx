import React, { useState } from 'react';
import { AuditLogItem, UpstreamServer, User } from '../types';
import { FileText, Filter, RefreshCw, ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock, Search, ShieldCheck } from 'lucide-react';

interface AuditTabProps {
  logs: AuditLogItem[];
  total: number;
  servers: UpstreamServer[];
  user: User;
  onFilterChange: (filters: { server?: string; outcome?: string; user_email?: string }) => void;
  onRefresh: () => Promise<void>;
}

export const AuditTab: React.FC<AuditTabProps> = ({
  logs,
  total,
  servers,
  user,
  onFilterChange,
  onRefresh,
}) => {
  const [selectedServer, setSelectedServer] = useState('');
  const [selectedOutcome, setSelectedOutcome] = useState('all');
  const [userEmailSearch, setUserEmailSearch] = useState('');
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const applyFilters = () => {
    onFilterChange({
      server: selectedServer || undefined,
      outcome: selectedOutcome,
      user_email: userEmailSearch || undefined,
    });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Tool Execution Audit Log</h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time compliance log of every MCP tool invocation through the gateway.
          </p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center px-3.5 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm self-start sm:self-auto"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin text-indigo-600' : 'text-slate-400'}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center text-xs font-semibold text-slate-500 uppercase tracking-wider mr-2">
          <Filter className="w-4 h-4 mr-1 text-slate-400" />
          Filters:
        </div>

        {/* Server filter */}
        <select
          value={selectedServer}
          onChange={(e) => {
            setSelectedServer(e.target.value);
            onFilterChange({
              server: e.target.value || undefined,
              outcome: selectedOutcome,
              user_email: userEmailSearch || undefined,
            });
          }}
          className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">All Upstream Servers</option>
          {servers.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name} ({s.slug})
            </option>
          ))}
        </select>

        {/* Outcome filter */}
        <select
          value={selectedOutcome}
          onChange={(e) => {
            setSelectedOutcome(e.target.value);
            onFilterChange({
              server: selectedServer || undefined,
              outcome: e.target.value,
              user_email: userEmailSearch || undefined,
            });
          }}
          className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:ring-1 focus:ring-indigo-500"
        >
          <option value="all">All Outcomes</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
          <option value="timeout">Timeout</option>
        </select>

        {/* User email search (for admins) */}
        {user.role === 'admin' && (
          <div className="flex-1 relative">
            <input
              type="text"
              value={userEmailSearch}
              onChange={(e) => setUserEmailSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              placeholder="Filter by user email (press Enter)..."
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        )}

        <div className="ml-auto text-xs text-slate-500">
          Showing <span className="font-semibold text-slate-800">{logs.length}</span> of {total} records
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 font-semibold text-xs uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3.5 w-8"></th>
                <th className="px-5 py-3.5">Timestamp</th>
                <th className="px-5 py-3.5">User</th>
                <th className="px-5 py-3.5">Tool Invoked</th>
                <th className="px-5 py-3.5">Duration</th>
                <th className="px-5 py-3.5">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-slate-400 italic">
                    No audit records match the current filter.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isExpanded = expandedRow === log.id;
                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        onClick={() => setExpandedRow(isExpanded ? null : log.id)}
                        className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                      >
                        <td className="pl-5 py-3.5 text-slate-400">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-indigo-600" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="px-5 py-3.5 text-xs font-medium text-slate-800 whitespace-nowrap">
                          {log.user_email || '—'}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                            {log.server_slug}__{log.tool_name}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-xs font-mono text-slate-600 whitespace-nowrap">
                          {log.duration_ms} ms
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {log.outcome === 'success' && (
                            <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                              Success
                            </span>
                          )}
                          {log.outcome === 'error' && (
                            <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                              <XCircle className="w-3.5 h-3.5 mr-1 text-rose-600" />
                              Error
                            </span>
                          )}
                          {log.outcome === 'timeout' && (
                            <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                              <Clock className="w-3.5 h-3.5 mr-1 text-amber-600" />
                              Timeout
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* Expanded Row */}
                      {isExpanded && (
                        <tr className="bg-slate-50/70 border-b border-slate-100">
                          <td colSpan={6} className="px-10 py-4">
                            <div className="space-y-3">
                              {log.error_message && (
                                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                                  <strong>Error: </strong> {log.error_message}
                                </div>
                              )}

                              <div>
                                <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-600 mb-1">
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>Sanitized Arguments (Inspected & Redacted):</span>
                                </div>
                                <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto max-h-48">
                                  {JSON.stringify(log.request_args_sanitized || {}, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
