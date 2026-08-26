'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  Search,
  Filter,
  ArrowLeft,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  User,
  Target,
  Calendar,
} from 'lucide-react';
import { useStellarConfig } from '@/contexts/StellarConfigContext';
import { useAuthGuard } from '@/hooks/useAuthGuard';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface AuditLog {
  id: string;
  action: string;
  target: string;
  performedBy: string;
  timestamp: string;
  status: 'success' | 'failed' | 'pending';
  details?: Record<string, unknown>;
  environment: string;
  ipAddress?: string;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: AuditLog['status'] }) {
  const styles = {
    success: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20',
    failed: 'bg-red-500/20 text-red-400 border-red-500/20',
    pending: 'bg-amber-500/20 text-amber-400 border-amber-500/20',
  };

  const icons = {
    success: <CheckCircle className="w-3 h-3" />,
    failed: <XCircle className="w-3 h-3" />,
    pending: <Clock className="w-3 h-3" />,
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${styles[status]}`}>
      {icons[status]}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function AuditLogsClient() {
  const router = useRouter();
  const { config } = useStellarConfig();
  const { loading: authLoading, isAuthenticated } = useAuthGuard();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<AuditLog['status'] | 'all'>('all');
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadLogs();
    }
  }, [authLoading, isAuthenticated]);

  const loadLogs = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE}/admin/audit-logs?limit=50`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Failed to load logs: ${response.statusText}`);
      }
      const data = await response.json();
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
      // Use mock data as fallback
      setLogs([
        {
          id: '1',
          action: 'ROTATE_CONTRACT',
          target: 'crowdfund_vault',
          performedBy: 'admin@example.com',
          timestamp: new Date().toISOString(),
          status: 'success',
          environment: 'testnet',
          details: { oldAddress: '0x123...', newAddress: '0x456...' },
        },
        {
          id: '2',
          action: 'PAUSE_CONTRACT',
          target: 'treasury',
          performedBy: 'admin@example.com',
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          status: 'success',
          environment: 'testnet',
        },
        {
          id: '3',
          action: 'SYNC_VAULT',
          target: 'crowdfund_vault',
          performedBy: 'system',
          timestamp: new Date(Date.now() - 7200000).toISOString(),
          status: 'failed',
          environment: 'testnet',
          details: { error: 'RPC timeout' },
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!authLoading && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <FileText className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
          <h2 className="text-xl font-semibold">Access Denied</h2>
          <p className="text-foreground/50 text-sm mt-2">You do not have permission to view audit logs.</p>
        </div>
      </div>
    );
  }

  const filteredLogs = logs.filter((log) => {
    if (statusFilter !== 'all' && log.status !== statusFilter) return false;
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      return (
        log.action.toLowerCase().includes(searchLower) ||
        log.target.toLowerCase().includes(searchLower) ||
        log.performedBy.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <section className="relative pt-24 pb-8 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="container mx-auto max-w-5xl relative z-10">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/admin')}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Audit Logs</h1>
              <p className="text-foreground/50 text-base">
                View and filter admin action audit history
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="px-4 pb-20">
        <div className="container mx-auto max-w-5xl">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
              <input
                type="text"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-foreground/30 focus:outline-none focus:border-primary/50"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as AuditLog['status'] | 'all')}
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-primary/50"
              >
                <option value="all">All Status</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
              </select>
              <button
                onClick={loadLogs}
                disabled={isLoading}
                className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Results */}
          {isLoading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          ) : error ? (
            <div className="p-8 text-center border border-red-500/20 rounded-2xl bg-red-500/5">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
              <p className="text-red-400 text-sm">{error}</p>
              <button
                onClick={loadLogs}
                className="mt-3 text-sm text-primary hover:underline"
              >
                Retry
              </button>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-12 text-center border border-white/5 rounded-2xl bg-white/[0.02]">
              <FileText className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
              <p className="text-foreground/40">No audit logs found</p>
              <p className="text-foreground/30 text-sm mt-1">
                {searchTerm || statusFilter !== 'all' ? 'Try adjusting your filters' : 'Logs will appear here as actions are performed'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="border border-white/5 rounded-xl bg-white/[0.02] overflow-hidden hover:border-white/10 transition-colors"
                >
                  <div
                    className="p-4 cursor-pointer"
                    onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-sm font-medium">{log.action}</span>
                          <span className="text-xs text-foreground/40">
                            <Target className="w-3 h-3 inline mr-1" />
                            {log.target}
                          </span>
                          <StatusBadge status={log.status} />
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-foreground/40">
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {log.performedBy}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDate(log.timestamp)}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-white/5">
                            {log.environment}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {expandedLog === log.id ? (
                          <ChevronUp className="w-4 h-4 text-foreground/30" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-foreground/30" />
                        )}
                      </div>
                    </div>
                  </div>

                  {expandedLog === log.id && log.details && (
                    <div className="px-4 pb-4 pt-0 border-t border-white/5">
                      <div className="mt-3 p-3 rounded-lg bg-white/5 border border-white/5 overflow-x-auto">
                        <pre className="text-xs text-foreground/60 whitespace-pre-wrap">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      </div>
                      {log.ipAddress && (
                        <p className="text-xs text-foreground/30 mt-2">
                          IP: {log.ipAddress}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}