'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Shield,
  RefreshCw,
  ArrowLeft,
  Warning,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Clipboard,
  ExternalLink,
} from 'lucide-react';
import { useStellarConfig } from '@/contexts/StellarConfigContext';
import { useStellarWallet } from '@/app/providers';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { useExplorerUrl } from '@/hooks/useExplorerUrl';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface ActionDefinition {
  id: string;
  name: string;
  description: string;
  category: 'vault' | 'treasury' | 'vesting' | 'registry' | 'system';
  dangerLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresConfirmation: boolean;
  confirmationText?: string;
  parameters?: {
    name: string;
    type: 'text' | 'number' | 'address' | 'select';
    required: boolean;
    options?: string[];
    placeholder?: string;
  }[];
}

const AVAILABLE_ACTIONS: ActionDefinition[] = [
  {
    id: 'rotate_contract',
    name: 'Rotate Contract',
    description: 'Update the contract address for a specific service. This is a critical operation.',
    category: 'vault',
    dangerLevel: 'critical',
    requiresConfirmation: true,
    confirmationText: 'ROTATE_CONTRACT',
    parameters: [
      { name: 'contractType', type: 'select', required: true, options: ['crowdfund_vault', 'treasury', 'vesting'] },
      { name: 'newAddress', type: 'address', required: true, placeholder: 'Enter new contract address...' },
    ],
  },
  {
    id: 'pause_contract',
    name: 'Pause Contract',
    description: 'Temporarily pause all operations on the specified contract.',
    category: 'vault',
    dangerLevel: 'high',
    requiresConfirmation: true,
    confirmationText: 'PAUSE_CONTRACT',
    parameters: [
      { name: 'contractType', type: 'select', required: true, options: ['crowdfund_vault', 'treasury', 'vesting'] },
    ],
  },
  {
    id: 'unpause_contract',
    name: 'Unpause Contract',
    description: 'Resume operations on a paused contract.',
    category: 'vault',
    dangerLevel: 'medium',
    requiresConfirmation: true,
    confirmationText: 'UNPAUSE_CONTRACT',
    parameters: [
      { name: 'contractType', type: 'select', required: true, options: ['crowdfund_vault', 'treasury', 'vesting'] },
    ],
  },
  {
    id: 'emergency_stop',
    name: 'Emergency Stop',
    description: 'Immediately halt all contract operations. This is irreversible without admin intervention.',
    category: 'system',
    dangerLevel: 'critical',
    requiresConfirmation: true,
    confirmationText: 'EMERGENCY_STOP',
    parameters: [],
  },
  {
    id: 'sync_vault',
    name: 'Sync Vault Events',
    description: 'Trigger a manual sync of vault events from the blockchain.',
    category: 'vault',
    dangerLevel: 'low',
    requiresConfirmation: false,
    parameters: [
      { name: 'vaultAddress', type: 'address', required: true, placeholder: 'Enter vault address...' },
      { name: 'fromLedger', type: 'number', required: false, placeholder: 'Start ledger (optional)' },
    ],
  },
  {
    id: 'refresh_metadata',
    name: 'Refresh Contract Metadata',
    description: 'Reload contract metadata from the blockchain.',
    category: 'registry',
    dangerLevel: 'low',
    requiresConfirmation: false,
    parameters: [],
  },
];

const DANGER_COLORS = {
  low: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  high: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  critical: 'text-red-400 bg-red-500/10 border-red-500/20',
};

const DANGER_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'CRITICAL',
};

function formatAddress(address: string): string {
  if (!address) return '';
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function StatusBadge({ status }: { status: 'idle' | 'pending' | 'success' | 'error' }) {
  const styles = {
    idle: 'bg-white/5 text-foreground/40',
    pending: 'bg-amber-500/20 text-amber-400 animate-pulse',
    success: 'bg-emerald-500/20 text-emerald-400',
    error: 'bg-red-500/20 text-red-400',
  };

  const labels = {
    idle: 'Ready',
    pending: 'Executing...',
    success: 'Success',
    error: 'Failed',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${styles[status]}`}>
      {status === 'pending' && <RefreshCw className="w-3 h-3 mr-1 animate-spin" />}
      {status === 'success' && <CheckCircle className="w-3 h-3 mr-1" />}
      {status === 'error' && <XCircle className="w-3 h-3 mr-1" />}
      {labels[status]}
    </span>
  );
}

export default function AdminActionsClient() {
  const router = useRouter();
  const { config, status: configStatus } = useStellarConfig();
  const { publicKey } = useStellarWallet();
  const { loading: authLoading, isAuthenticated } = useAuthGuard();
  const buildExplorerUrl = useExplorerUrl();

  const [selectedAction, setSelectedAction] = useState<ActionDefinition | null>(null);
  const [actionStatus, setActionStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [confirmationValue, setConfirmationValue] = useState('');
  const [isConfirmationEnabled, setIsConfirmationEnabled] = useState(false);
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [showDetails, setShowDetails] = useState(false);

  const isTestnet = config?.network === 'testnet';
  const isMainnet = config?.network === 'mainnet';
  const hasValidConfig = configStatus === 'ready' && config;

  const handleActionSelect = (action: ActionDefinition) => {
    setSelectedAction(action);
    setActionStatus('idle');
    setStatusMessage(null);
    setResult(null);
    setConfirmationValue('');
    setIsConfirmationEnabled(false);
    setParameters({});
  };

  const handleParameterChange = (name: string, value: string) => {
    setParameters((prev) => ({ ...prev, [name]: value }));
  };

  const handleExecute = async () => {
    if (!selectedAction || !hasValidConfig) return;

    // Check if confirmation is required and matches
    if (selectedAction.requiresConfirmation && selectedAction.confirmationText) {
      if (confirmationValue !== selectedAction.confirmationText) {
        setStatusMessage('Confirmation text does not match. Please enter the exact confirmation code.');
        return;
      }
    }

    setActionStatus('pending');
    setStatusMessage(`Executing ${selectedAction.name}...`);

    try {
      // This would call the actual API endpoint
      const response = await fetch(`${API_BASE}/admin/actions/${selectedAction.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parameters,
          performedBy: publicKey,
          environment: config.network,
        }),
      });

      if (!response.ok) {
        throw new Error(`Action failed: ${response.statusText}`);
      }

      const data = await response.json();
      setActionStatus('success');
      setStatusMessage(`Action ${selectedAction.name} completed successfully`);
      setResult(data);
    } catch (err) {
      setActionStatus('error');
      setStatusMessage(err instanceof Error ? err.message : 'Action failed');
    }
  };

  // Redirect if not authenticated
  if (!authLoading && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
          <h2 className="text-xl font-semibold">Access Denied</h2>
          <p className="text-foreground/50 text-sm mt-2">You do not have permission to access this page.</p>
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
            <p className="text-foreground/50 text-sm mt-2">
              Contract metadata is missing or misconfigured. Actions cannot be executed safely.
            </p>
            <button
              onClick={() => router.push('/admin')}
              className="mt-4 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Back to Console
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main render
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
              <h1 className="text-3xl font-bold tracking-tight">Contract Actions</h1>
              <p className="text-foreground/50 text-base">
                Execute guarded contract operations with explicit confirmation
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="px-4 pb-20">
        <div className="container mx-auto max-w-5xl">
          {/* Environment Warning */}
          {isMainnet && (
            <div className="mb-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-400">⚠️ MAINNET ENVIRONMENT</p>
                  <p className="text-xs text-foreground/50 mt-1">
                    You are operating on mainnet. All actions are irreversible. Double-check every parameter.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Action List */}
            <div className="lg:col-span-1">
              <div className="sticky top-24">
                <h2 className="text-sm font-semibold text-foreground/50 mb-3">Available Actions</h2>
                <div className="space-y-2">
                  {AVAILABLE_ACTIONS.map((action) => (
                    <button
                      key={action.id}
                      onClick={() => handleActionSelect(action)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${
                        selectedAction?.id === action.id
                          ? 'border-primary/50 bg-primary/10'
                          : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{action.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${DANGER_COLORS[action.dangerLevel]}`}>
                          {DANGER_LABELS[action.dangerLevel]}
                        </span>
                      </div>
                      <p className="text-xs text-foreground/40 mt-1 line-clamp-2">{action.description}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] text-foreground/30">
                          {action.category}
                        </span>
                        {action.requiresConfirmation && (
                          <span className="text-[10px] text-amber-400 flex items-center gap-1">
                            <Lock className="w-3 h-3" />
                            Requires confirmation
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Action Details */}
            <div className="lg:col-span-2">
              {selectedAction ? (
                <div className="border border-white/5 rounded-2xl bg-white/[0.02] p-6">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-xl font-bold">{selectedAction.name}</h2>
                      <p className="text-sm text-foreground/50 mt-1">{selectedAction.description}</p>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-bold border ${DANGER_COLORS[selectedAction.dangerLevel]}`}>
                      {DANGER_LABELS[selectedAction.dangerLevel]} RISK
                    </div>
                  </div>

                  {/* Parameters */}
                  {selectedAction.parameters && selectedAction.parameters.length > 0 && (
                    <div className="mb-4 space-y-3">
                      <h3 className="text-sm font-semibold text-foreground/50">Parameters</h3>
                      {selectedAction.parameters.map((param) => (
                        <div key={param.name}>
                          <label className="text-xs text-foreground/40 block mb-1">
                            {param.name}
                            {param.required && <span className="text-red-400 ml-1">*</span>}
                          </label>
                          {param.type === 'select' ? (
                            <select
                              value={parameters[param.name] || ''}
                              onChange={(e) => handleParameterChange(param.name, e.target.value)}
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                            >
                              <option value="">Select...</option>
                              {param.options?.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={param.type === 'number' ? 'number' : 'text'}
                              placeholder={param.placeholder}
                              value={parameters[param.name] || ''}
                              onChange={(e) => handleParameterChange(param.name, e.target.value)}
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-primary/50"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Confirmation */}
                  {selectedAction.requiresConfirmation && selectedAction.confirmationText && (
                    <div className="mb-4 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-amber-400">Confirmation Required</p>
                          <p className="text-xs text-foreground/50 mt-1">
                            Type <span className="font-mono font-bold text-amber-400">{selectedAction.confirmationText}</span> to confirm this action.
                          </p>
                          <input
                            type="text"
                            value={confirmationValue}
                            onChange={(e) => {
                              setConfirmationValue(e.target.value);
                              setIsConfirmationEnabled(e.target.value === selectedAction.confirmationText);
                            }}
                            placeholder="Enter confirmation code..."
                            className="mt-2 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-primary/50"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Status */}
                  {statusMessage && (
                    <div className={`mb-4 p-3 rounded-lg text-sm ${
                      actionStatus === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                      actionStatus === 'error' ? 'bg-red-500/10 text-red-400' :
                      'bg-amber-500/10 text-amber-400'
                    }`}>
                      <div className="flex items-center gap-2">
                        {actionStatus === 'pending' && <RefreshCw className="w-4 h-4 animate-spin" />}
                        {actionStatus === 'success' && <CheckCircle className="w-4 h-4" />}
                        {actionStatus === 'error' && <XCircle className="w-4 h-4" />}
                        {statusMessage}
                      </div>
                    </div>
                  )}

                  {/* Result */}
                  {result && (
                    <div className="mb-4">
                      <button
                        onClick={() => setShowDetails(!showDetails)}
                        className="flex items-center gap-2 text-sm text-foreground/50 hover:text-foreground transition-colors"
                      >
                        {showDetails ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        {showDetails ? 'Hide' : 'View'} Result Details
                      </button>
                      {showDetails && (
                        <pre className="mt-2 p-3 rounded-lg bg-white/5 border border-white/10 text-xs text-foreground/60 overflow-x-auto">
                          {JSON.stringify(result, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}

                  {/* Execute Button */}
                  <div className="flex items-center gap-3 pt-4 border-t border-white/5">
                    <button
                      onClick={handleExecute}
                      disabled={
                        actionStatus === 'pending' ||
                        (selectedAction.requiresConfirmation && !isConfirmationEnabled) ||
                        (selectedAction.parameters?.some(
                          (p) => p.required && !parameters[p.name]
                        ) ?? false) ||
                        !isTestnet
                      }
                      className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        selectedAction.dangerLevel === 'critical' || selectedAction.dangerLevel === 'high'
                          ? 'bg-red-500 hover:bg-red-600 text-white'
                          : 'bg-primary hover:bg-primary/90 text-black'
                      }`}
                      title={
                        !isTestnet 
                          ? 'Actions are only available on testnet' 
                          : selectedAction.requiresConfirmation && !isConfirmationEnabled 
                            ? 'Please confirm the action first' 
                            : undefined
                      }
                    >
                      {actionStatus === 'pending' ? (
                        <>
                          <RefreshCw className="w-4 h-4 inline animate-spin mr-2" />
                          Executing...
                        </>
                      ) : (
                        `Execute ${selectedAction.name}`
                      )}
                    </button>
                    {!isTestnet && (
                      <span className="text-xs text-foreground/30 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Testnet only
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="border border-white/5 rounded-2xl bg-white/[0.02] p-12 text-center">
                  <Shield className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
                  <p className="text-foreground/40">Select an action from the list to begin.</p>
                  <p className="text-foreground/30 text-sm mt-1">Each action includes safety checks and confirmation requirements.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}