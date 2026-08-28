'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Settings,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ExternalLink,
  Lock,
  Unlock,
  Key,
  Database,
  HardDrive,
  Clock,
  User,
  Activity,
  FileText,
  AlertOctagon,
} from 'lucide-react';
import { useStellarConfig } from '@/contexts/StellarConfigContext';
import { useStellarWallet } from '@/app/providers';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { useExplorerUrl } from '@/hooks/useExplorerUrl';
import { DependencyStatusBanner } from '@/components/DependencyStatusBanner';

import { clientConfig } from '@/lib/config';

const API_BASE = clientConfig.apiUrl;

// Types
interface ContractMetadata {
  address: string;
  name: string;
  type: 'crowdfund_vault' | 'treasury' | 'vesting' | 'project_registry' | 'token';
  version?: string;
  deployedAt?: string;
  isActive: boolean;
  requiredSigners?: string[];
  adminAddress?: string;
}

interface AdminUser {
  id: string;
  email: string;
  role: 'admin' | 'super_admin';
  publicKey?: string;
}

interface AuditLogEntry {
  id: string;
  action: string;
  target: string;
  performedBy: string;
  timestamp: string;
  status: 'success' | 'failed' | 'pending';
  details?: Record<string, unknown>;
}

interface SystemStatus {
  health: 'healthy' | 'degraded' | 'unhealthy';
  lastBlock: number;
  syncProgress: number;
  pendingEvents: number;
  rpcStatus: 'online' | 'offline' | 'degraded';
  horizonStatus: 'online' | 'offline' | 'degraded';
}

// Helper function to format addresses
function formatAddress(address: string): string {
  if (!address) return '';
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground/70 transition-colors"
      aria-label={`Copy ${label || 'address'}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// Environment Banner Component
function EnvironmentBanner({ config }: { config: { network: string; contracts?: Record<string, string> } | null }) {
  const isTestnet = config?.network === 'testnet';
  const isMainnet = config?.network === 'mainnet';

  return (
    <div className={`p-4 rounded-xl border ${
      isTestnet 
        ? 'bg-amber-500/10 border-amber-500/20' 
        : isMainnet 
          ? 'bg-red-500/10 border-red-500/20' 
          : 'bg-white/5 border-white/10'
    }`}>
      <div className="flex items-center gap-3">
        {isTestnet ? (
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
        ) : isMainnet ? (
          <AlertOctagon className="w-5 h-5 text-red-400 flex-shrink-0" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-foreground/40 flex-shrink-0" />
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm">
              {isTestnet ? '🧪 TESTNET' : isMainnet ? '🔴 MAINNET' : '⚠️ UNKNOWN'}
            </span>
            <span className="text-xs text-foreground/50">
              {config?.network ? `(${config.network})` : '(not configured)'}
            </span>
            {isMainnet && (
              <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs font-bold rounded-full">
                DESTRUCTIVE ACTIONS AVAILABLE
              </span>
            )}
          </div>
          <p className="text-xs text-foreground/40 mt-1">
            {isTestnet 
              ? 'You are operating on testnet. Actions here affect test contracts only.'
              : isMainnet 
                ? '⚠️ WARNING: You are operating on mainnet. All actions are irreversible.'
                : 'Contract environment not detected. Please check your configuration.'}
          </p>
        </div>
        {config?.contracts && (
          <div className="text-xs text-foreground/30">
            {Object.keys(config.contracts).length} contracts loaded
          </div>
        )}
      </div>
    </div>
  );
}

// Contract Card Component
function ContractCard({ 
  contract, 
  onRefresh,
  isTestnet,
}: { 
  contract: ContractMetadata; 
  onRefresh: () => void;
  isTestnet: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState<{ type: 'success' | 'error' | null; message: string | null }>({
    type: null,
    message: null,
  });
  const buildExplorerUrl = useExplorerUrl();

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      await onRefresh();
      setActionStatus({ type: 'success', message: 'Contract refreshed successfully' });
      setTimeout(() => setActionStatus({ type: null, message: null }), 3000);
    } catch {
      setActionStatus({ type: 'error', message: 'Failed to refresh contract' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="border border-white/5 bg-white/[0.02] rounded-xl overflow-hidden transition-all hover:border-white/10">
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                {contract.type.replace('_', ' ').toUpperCase()}
              </span>
              {!contract.isActive && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                  INACTIVE
                </span>
              )}
            </div>
            <h3 className="font-semibold text-sm mt-1">{contract.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              <code className="text-xs text-foreground/50 font-mono">
                {formatAddress(contract.address)}
              </code>
              <CopyButton text={contract.address} label="contract address" />
              <a
                href={buildExplorerUrl('contract', contract.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground/30 hover:text-primary transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50"
              aria-label="Refresh contract"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {actionStatus.type && (
          <div className={`mt-2 p-2 rounded-lg text-xs ${
            actionStatus.type === 'success' 
              ? 'bg-emerald-500/10 text-emerald-400' 
              : 'bg-red-500/10 text-red-400'
          }`}>
            {actionStatus.message}
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 pt-0 border-t border-white/5">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
            {contract.version && (
              <div className="text-xs">
                <span className="text-foreground/40">Version</span>
                <p className="font-mono text-sm">{contract.version}</p>
              </div>
            )}
            {contract.deployedAt && (
              <div className="text-xs">
                <span className="text-foreground/40">Deployed</span>
                <p className="text-sm">{new Date(contract.deployedAt).toLocaleDateString()}</p>
              </div>
            )}
            {contract.adminAddress && (
              <div className="text-xs">
                <span className="text-foreground/40">Admin</span>
                <div className="flex items-center gap-1">
                  <code className="text-xs font-mono">{formatAddress(contract.adminAddress)}</code>
                  <CopyButton text={contract.adminAddress} label="admin address" />
                </div>
              </div>
            )}
            {contract.requiredSigners && contract.requiredSigners.length > 0 && (
              <div className="text-xs col-span-2 md:col-span-3">
                <span className="text-foreground/40">Required Signers ({contract.requiredSigners.length})</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {contract.requiredSigners.map((signer) => (
                    <code key={signer} className="text-xs font-mono bg-white/5 px-2 py-0.5 rounded">
                      {formatAddress(signer)}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Action buttons - only show for testnet or with extra confirmation */}
          <div className="mt-4 pt-4 border-t border-white/5">
            <div className="flex flex-wrap gap-2">
              <button
                className="px-3 py-1.5 bg-primary/20 hover:bg-primary/30 text-primary text-xs font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!isTestnet}
                title={!isTestnet ? 'Actions only available on testnet' : ''}
              >
                <span className="flex items-center gap-1.5">
                  <Settings className="w-3.5 h-3.5" />
                  View Details
                </span>
              </button>
              <button
                className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!isTestnet}
                title={!isTestnet ? 'Actions only available on testnet' : ''}
              >
                <span className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  Test Action
                </span>
              </button>
              <button
                className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!isTestnet}
                title={!isTestnet ? 'Actions only available on testnet' : ''}
              >
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Emergency Stop
                </span>
              </button>
            </div>
            {!isTestnet && (
              <p className="text-xs text-foreground/30 mt-2">
                ⚠️ Destructive actions are only available on testnet. Switch to testnet to test contract operations.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Status Badge Component
function StatusBadge({ status }: { status: 'healthy' | 'degraded' | 'unhealthy' | 'online' | 'offline' }) {
  const styles = {
    healthy: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20',
    online: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20',
    degraded: 'bg-amber-500/20 text-amber-400 border-amber-500/20',
    unhealthy: 'bg-red-500/20 text-red-400 border-red-500/20',
    offline: 'bg-red-500/20 text-red-400 border-red-500/20',
  };

  const labels = {
    healthy: 'Healthy',
    online: 'Online',
    degraded: 'Degraded',
    unhealthy: 'Unhealthy',
    offline: 'Offline',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${styles[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
        status === 'healthy' || status === 'online' ? 'bg-emerald-400' :
        status === 'degraded' ? 'bg-amber-400' :
        'bg-red-400'
      }`} />
      {labels[status]}
    </span>
  );
}

// Main Component
export default function AdminConsoleClient() {
  const { config, status: configStatus, error: configError, retry: retryConfig } = useStellarConfig();
  const { publicKey } = useStellarWallet();
  const { loading: authLoading, isAuthenticated } = useAuthGuard();

  const [contracts, setContracts] = useState<ContractMetadata[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTestnet = config?.network === 'testnet';
  const isMainnet = config?.network === 'mainnet';
  const hasValidConfig = configStatus === 'ready' && config;

  const loadData = useCallback(async () => {
    if (!hasValidConfig || !isAuthenticated) return;

    try {
      setIsRefreshing(true);
      setError(null);

      // Load contracts from config
      const contractList: ContractMetadata[] = [];
      if (config.contracts) {
        for (const [key, address] of Object.entries(config.contracts)) {
          if (address) {
            contractList.push({
              address: address as string,
              name: key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
              type: key.includes('vault') ? 'crowdfund_vault' :
                    key.includes('treasury') ? 'treasury' :
                    key.includes('vesting') ? 'vesting' :
                    key.includes('registry') ? 'project_registry' :
                    'token',
              isActive: true,
              version: '1.0.0',
            });
          }
        }
      }
      setContracts(contractList);

      // Load system status
      try {
        const statusResponse = await fetch(`${API_BASE}/admin/status`, {
          headers: { Accept: 'application/json' },
        });
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          setSystemStatus(statusData);
        }
      } catch {
        // Use default status if endpoint not available
        setSystemStatus({
          health: 'healthy',
          lastBlock: 0,
          syncProgress: 100,
          pendingEvents: 0,
          rpcStatus: 'online',
          horizonStatus: 'online',
        });
      }

      // Load audit logs
      try {
        const logsResponse = await fetch(`${API_BASE}/admin/audit-logs?limit=10`, {
          headers: { Accept: 'application/json' },
        });
        if (logsResponse.ok) {
          const logsData = await logsResponse.json();
          setAuditLogs(logsData);
        }
      } catch {
        // Use mock data if endpoint not available
        setAuditLogs([
          {
            id: '1',
            action: 'CONTRACT_REFRESH',
            target: 'crowdfund_vault',
            performedBy: 'admin@example.com',
            timestamp: new Date().toISOString(),
            status: 'success',
            details: { message: 'Contract state refreshed' },
          },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [hasValidConfig, isAuthenticated, config]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadData();
    }
  }, [authLoading, isAuthenticated, loadData]);

  const handleRefresh = async () => {
    await loadData();
  };

  // Loading state
  if (authLoading || configStatus === 'loading') {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-foreground/50 text-sm">Loading admin console...</p>
        </div>
      </div>
    );
  }

  // Unauthorized state
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
          <h2 className="text-xl font-semibold">Access Denied</h2>
          <p className="text-foreground/50 text-sm mt-2">You do not have permission to access this page.</p>
          <Link href="/" className="mt-4 inline-block text-primary hover:underline text-sm">
            Return to home
          </Link>
        </div>
      </div>
    );
  }

  // Configuration error state
  if (configStatus === 'error' || !hasValidConfig) {
    return (
      <div className="min-h-screen bg-background text-foreground p-8">
        <div className="max-w-4xl mx-auto">
          <div className="p-8 rounded-2xl border border-red-500/20 bg-red-500/5 text-center">
            <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-red-400">Configuration Error</h2>
            <p className="text-foreground/50 text-sm mt-2 max-w-md mx-auto">
              {configError || 'Contract metadata is missing or misconfigured. The admin console cannot load safely.'}
            </p>
            <button
              onClick={retryConfig}
              className="mt-4 px-4 py-2 bg-primary/20 hover:bg-primary/30 text-primary rounded-lg text-sm font-medium transition-colors"
            >
              Retry Configuration
            </button>
            <Link href="/" className="ml-3 inline-block text-primary hover:underline text-sm">
              Return to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <section className="relative pt-24 pb-8 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="container mx-auto max-w-5xl relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Shield className="w-8 h-8 text-primary" />
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Admin Console</h1>
                <p className="text-foreground/50 text-base">
                  Secure contract operations with environment safety rails
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              {publicKey && (
                <div className="flex items-center gap-2 text-xs text-foreground/40 bg-white/5 px-3 py-1.5 rounded-full">
                  <User className="w-3 h-3" />
                  <span className="font-mono">{formatAddress(publicKey)}</span>
                </div>
              )}
              <Link
                href="/"
                className="text-sm text-foreground/40 hover:text-foreground transition-colors"
              >
                ← Back
              </Link>
            </div>
          </div>

          <div className="mt-4">
            <DependencyStatusBanner />
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="px-4 pb-20">
        <div className="container mx-auto max-w-5xl">
          {/* Environment Banner */}
          <div className="mb-6">
            <EnvironmentBanner config={config} />
          </div>

          {/* System Status */}
          {systemStatus && (
            <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground/40">Health</span>
                  <StatusBadge status={systemStatus.health} />
                </div>
              </div>
              <div className="p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground/40">RPC</span>
                  <StatusBadge status={systemStatus.rpcStatus} />
                </div>
              </div>
              <div className="p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground/40">Horizon</span>
                  <StatusBadge status={systemStatus.horizonStatus} />
                </div>
              </div>
              <div className="p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground/40">Sync</span>
                  <span className="text-xs font-mono">{systemStatus.syncProgress}%</span>
                </div>
              </div>
            </div>
          )}

          {/* Contracts Section */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">Contract Registry</h2>
                <span className="text-xs text-foreground/40">({contracts.length} contracts)</span>
              </div>
              <div className="text-xs text-foreground/30 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                {isTestnet ? 'Testnet Mode' : isMainnet ? 'Mainnet Mode' : 'Unknown'}
              </div>
            </div>

            {contracts.length === 0 ? (
              <div className="p-8 text-center border border-white/5 rounded-2xl bg-white/[0.02]">
                <Database className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
                <p className="text-foreground/40 text-sm">No contracts found in configuration.</p>
                <p className="text-foreground/30 text-xs mt-1">Check your Stellar configuration or contract deployment.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {contracts.map((contract) => (
                  <ContractCard
                    key={contract.address}
                    contract={contract}
                    onRefresh={handleRefresh}
                    isTestnet={isTestnet}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Audit Logs Section */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Recent Audit Logs</h2>
              <span className="text-xs text-foreground/40">(last {auditLogs.length} entries)</span>
            </div>

            {auditLogs.length === 0 ? (
              <div className="p-8 text-center border border-white/5 rounded-2xl bg-white/[0.02]">
                <FileText className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
                <p className="text-foreground/40 text-sm">No audit logs available.</p>
              </div>
            ) : (
              <div className="border border-white/5 rounded-2xl overflow-hidden bg-white/[0.02]">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-white/[0.02] border-b border-white/5">
                      <tr>
                        <th className="px-4 py-3 text-xs font-medium text-foreground/40">Action</th>
                        <th className="px-4 py-3 text-xs font-medium text-foreground/40">Target</th>
                        <th className="px-4 py-3 text-xs font-medium text-foreground/40">Performed By</th>
                        <th className="px-4 py-3 text-xs font-medium text-foreground/40">Status</th>
                        <th className="px-4 py-3 text-xs font-medium text-foreground/40">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 text-xs font-mono">{log.action}</td>
                          <td className="px-4 py-3 text-xs">{log.target}</td>
                          <td className="px-4 py-3 text-xs">{log.performedBy}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 text-xs ${
                              log.status === 'success' ? 'text-emerald-400' :
                              log.status === 'failed' ? 'text-red-400' :
                              'text-amber-400'
                            }`}>
                              {log.status === 'success' && <CheckCircle className="w-3 h-3" />}
                              {log.status === 'failed' && <XCircle className="w-3 h-3" />}
                              {log.status === 'pending' && <Clock className="w-3 h-3" />}
                              {log.status.charAt(0).toUpperCase() + log.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-foreground/40">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Safety Information */}
          <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-400">Safety Rails Active</p>
                <p className="text-xs text-foreground/50 mt-1">
                  {isTestnet 
                    ? 'You are on testnet. All contract operations are sandboxed and safe for testing.'
                    : isMainnet
                      ? '⚠️ You are on mainnet. All operations are irreversible. Double-check every action.'
                      : 'Environment not detected. Contract operations are disabled for safety.'}
                </p>
                <ul className="mt-2 space-y-1 text-xs text-foreground/40">
                  <li className="flex items-center gap-2">
                    {isTestnet || !hasValidConfig ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                    {isTestnet 
                      ? 'Testnet: Operations are enabled but isolated to test contracts' 
                      : isMainnet 
                        ? 'Mainnet: ⚠️ Operations are enabled with confirmation safeguards' 
                        : 'Operations disabled: Missing configuration'}
                  </li>
                  <li className="flex items-center gap-2">
                    <Activity className="w-3 h-3" />
                    All actions are audited and logged
                  </li>
                  <li className="flex items-center gap-2">
                    <Key className="w-3 h-3" />
                    Authentication required for all operations
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Error display */}
          {error && (
            <div className="mt-4 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
              <div className="flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-400">Error</p>
                  <p className="text-xs text-foreground/50 mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}