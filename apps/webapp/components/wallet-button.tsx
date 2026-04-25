'use client';

<<<<<<< HEAD
import { useState, useEffect } from 'react';
import {
  Wallet,
  LogOut,
  X,
  XCircle,
  RefreshCw,
  ExternalLink,
  Loader2,
  CircleCheck,
  RotateCcw,
} from 'lucide-react';
import { useStellarWallet, WalletId } from '@/app/providers';
=======
import { useState } from "react";
import { Wallet, Copy, ExternalLink, Check, LogOut } from "lucide-react";
import { useStellarWallet } from "@/app/providers";
import { cn } from "@/lib/utils";
>>>>>>> 32ecf6ba4de3e51a30acc180ef439b0291d4ebf9

// ─── wallet icons ─────────────────────────────────────────────────────────────
// Defined as named components so they can be referenced by the WALLETS registry
// without pre-evaluating JSX at module initialisation time.

function FreighterIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
      <rect width="32" height="32" rx="8" fill="#6B46C1" />
      <path
        d="M8 16C8 11.582 11.582 8 16 8s8 3.582 8 8-3.582 8-8 8-8-3.582-8-8z"
        fill="white"
        fillOpacity="0.2"
      />
      <path d="M11 16l3.5-5 3.5 5-3.5 2.5L11 16z" fill="white" />
      <path d="M18 16l3 2-3 2v-4z" fill="white" fillOpacity="0.7" />
    </svg>
  );
}

<<<<<<< HEAD
function BraavosIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
      <rect width="32" height="32" rx="8" fill="#FF6B35" />
      <path
        d="M16 7l7 4v10l-7 4-7-4V11l7-4z"
        fill="white"
        fillOpacity="0.25"
        stroke="white"
        strokeWidth="1.5"
      />
      <path d="M16 11l4 2.5v5L16 21l-4-2.5v-5L16 11z" fill="white" />
    </svg>
  );
}
=======
export function WalletButton({ className }: { className?: string }) {
  const { publicKey, status, connect, disconnect } = useStellarWallet();

  if (status === "connected" && publicKey) {
    return (
      <AccountSummary
        address={publicKey}
        onDisconnect={disconnect}
      />
    );
  }

  return (
    <button
      onClick={connect}
      disabled={status === "connecting"}
      className={cn(
        "relative rounded-lg px-4 py-2 font-medium flex items-center gap-2 transition-all duration-300",
        "bg-primary text-primary-foreground hover:opacity-90",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
    >
      <Wallet className="w-4 h-4" />
      {status === "connecting" ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}

export function AccountSummary({
  address,
  network = "testnet",
  onDisconnect,
}: AccountSummaryProps) {
  const [copied, setCopied] = useState(false);
>>>>>>> 32ecf6ba4de3e51a30acc180ef439b0291d4ebf9

function ArgentIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
      <rect width="32" height="32" rx="8" fill="#FF875B" />
      <path d="M16 8l6 10H10l6-10z" fill="white" />
      <path d="M10 18h12l-2 6H12l-2-6z" fill="white" fillOpacity="0.7" />
    </svg>
  );
}

// ─── wallet registry ──────────────────────────────────────────────────────────
// Icon is stored as a component reference (React.ComponentType), not pre-rendered
// JSX, to avoid undefined-component errors during module initialisation.

interface WalletMeta {
  id: WalletId;
  name: string;
  description: string;
  installUrl: string;
  Icon: React.ComponentType;
}

const WALLETS: WalletMeta[] = [
  {
    id: 'freighter',
    name: 'Freighter',
    description: 'Stellar wallet',
    installUrl: 'https://www.freighter.app/',
    Icon: FreighterIcon,
  },
  {
    id: 'braavos',
    name: 'Braavos',
    description: 'Starknet wallet',
    installUrl:
      'https://chrome.google.com/webstore/detail/braavos-smart-wallet/jnlgamecbpmbajjfhmmmlhejkemejdma',
    Icon: BraavosIcon,
  },
  {
    id: 'argent',
    name: 'Argent',
    description: 'Starknet wallet',
    installUrl: 'https://www.argent.xyz/argent-x/',
    Icon: ArgentIcon,
  },
];

// ─── helpers ──────────────────────────────────────────────────────────────────

function truncateAddress(addr: string | null) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden />;
}

// ─── wallet row ───────────────────────────────────────────────────────────────

interface WalletRowProps {
  wallet: WalletMeta;
  isInstalled: boolean;
  isConnecting: boolean;
  isLastUsed: boolean;
  onConnect: (id: WalletId) => void;
}

function WalletRow({
  wallet,
  isInstalled,
  isConnecting,
  isLastUsed,
  onConnect,
}: WalletRowProps) {
  const { Icon } = wallet;

  const handleClick = () => {
    if (!isInstalled) {
      window.open(wallet.installUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    onConnect(wallet.id);
  };

  return (
    <button
      onClick={handleClick}
      disabled={isConnecting}
      className={[
        'w-full flex items-center gap-4 px-4 py-3 rounded-xl border transition-all duration-200 group text-left',
        'disabled:cursor-not-allowed',
        isLastUsed && isInstalled
          ? 'bg-[#db74cf]/[0.08] border-[#db74cf]/30 hover:bg-[#db74cf]/[0.12] hover:border-[#db74cf]/60'
          : isInstalled
          ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-[#db74cf]/60'
          : 'bg-white/[0.02] border-white/5 opacity-50 hover:opacity-70',
      ].join(' ')}
      aria-label={
        isInstalled
          ? `Connect ${wallet.name}${isLastUsed ? ' (last used)' : ''}`
          : `${wallet.name} not installed — click to install`
      }
    >
      {/* Icon */}
      <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 shadow-md">
        <Icon />
      </div>

      {/* Labels */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={[
              'font-semibold text-sm transition-colors',
              isInstalled
                ? 'text-white group-hover:text-[#db74cf]'
                : 'text-white/60',
            ].join(' ')}
          >
            {wallet.name}
          </span>

          {isLastUsed && isInstalled && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-[#db74cf]/15 text-[#db74cf] border border-[#db74cf]/25">
              Last Used
            </span>
          )}

          {!isInstalled && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/10 text-white/50 border border-white/10">
              Not Installed
            </span>
          )}
        </div>
        <p className="text-xs text-white/40 mt-0.5">{wallet.description}</p>
      </div>

      {/* Right side */}
      <div className="flex-shrink-0">
        {isConnecting ? (
          <Spinner className="w-4 h-4 text-[#db74cf]" />
        ) : isInstalled ? (
          <span className="text-xs text-white/30 group-hover:text-[#db74cf]/70 transition-colors">
            Connect →
          </span>
        ) : (
          <ExternalLink className="w-3.5 h-3.5 text-white/30 group-hover:text-white/50 transition-colors" />
        )}
      </div>
    </button>
  );
}

// ─── modal state banner ───────────────────────────────────────────────────────

interface ModalStateBannerProps {
  status: string;
  error: string | null;
  wasPreviouslyConnected: boolean;
  lastWallet: WalletId | null;
  connectingWalletId: WalletId | null;
  onRetry: () => void;
}

function ModalStateBanner({
  status,
  error,
  wasPreviouslyConnected,
  lastWallet,
  connectingWalletId,
  onRetry,
}: ModalStateBannerProps) {
  if (status === 'rejected') {
    return (
      <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
        <div className="flex items-start gap-3">
          <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-300">Connection Rejected</p>
            <p className="text-xs text-white/50 mt-0.5">
              You cancelled the request. Try again when ready.
            </p>
          </div>
          <button
            onClick={onRetry}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-medium hover:bg-red-500/30 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (status === 'disconnected' && error) {
    return (
      <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
        <div className="flex items-start gap-3">
          <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-300">Connection Failed</p>
            <p className="text-xs text-white/50 mt-0.5 truncate">{error}</p>
          </div>
          <button
            onClick={onRetry}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-medium hover:bg-red-500/30 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (
    (status === 'idle' || status === 'disconnected') &&
    wasPreviouslyConnected &&
    !error
  ) {
    const walletName =
      WALLETS.find((w) => w.id === lastWallet)?.name ?? 'your wallet';
    return (
      <div className="mb-4 rounded-xl border border-[#db74cf]/25 bg-[#db74cf]/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <RotateCcw className="w-4 h-4 text-[#db74cf]/70 flex-shrink-0" />
          <p className="text-xs text-white/60">
            Previously connected with{' '}
            <span className="text-[#db74cf] font-medium">{walletName}</span>.
            Select it below to reconnect.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'connecting' && connectingWalletId) {
    const walletName =
      WALLETS.find((w) => w.id === connectingWalletId)?.name ?? 'wallet';
    return (
      <div className="mb-4 rounded-xl border border-[#db74cf]/25 bg-[#db74cf]/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <Spinner className="w-4 h-4 text-[#db74cf]" />
          <p className="text-xs text-white/60">
            Waiting for{' '}
            <span className="text-[#db74cf] font-medium">{walletName}</span> —
            approve the request in the extension popup.
          </p>
        </div>
      </div>
    );
  }

  return null;
}

// ─── main component ───────────────────────────────────────────────────────────

interface WalletButtonProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function WalletButton({ className = '', size = 'md' }: WalletButtonProps) {
  const {
    publicKey,
    status,
    installState,
    connect,
    disconnect,
    error,
    wasPreviouslyConnected,
    lastWallet,
  } = useStellarWallet();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [connectingWalletId, setConnectingWalletId] = useState<WalletId | null>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Auto-close on successful connection
  useEffect(() => {
    if (status === 'connected' && isModalOpen) {
      setIsModalOpen(false);
      setConnectingWalletId(null);
    }
  }, [status, isModalOpen]);

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = isModalOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isModalOpen]);

  // Escape key
  useEffect(() => {
    if (!isModalOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsModalOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isModalOpen]);

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  };
  const iconSize =
    size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';

  const handleConnect = async (walletId: WalletId) => {
    setConnectingWalletId(walletId);
    await connect(walletId);
  };

  const handleRetry = () => {
    if (connectingWalletId) handleConnect(connectingWalletId);
  };

  const isConnecting = status === 'connecting';
  const isReconnecting = status === 'reconnecting';

  if (!isClient) return null;

  // ── Connected ──────────────────────────────────────────────────────────────
  if (status === 'connected') {
    return (
      <div className="flex items-center gap-2">
        <button
          title={publicKey ?? undefined}
          className={[
            'relative group rounded-lg font-medium flex items-center gap-2 transition-all duration-300',
            sizeClasses[size],
            className,
          ].join(' ')}
        >
          <span className="absolute inset-0 rounded-lg bg-black/30 backdrop-blur-sm" />
          <span className="absolute inset-0 rounded-lg border-2 border-[#db74cf] border-opacity-70 group-hover:border-opacity-100 transition-all" />
          <span className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-md bg-[#db74cf]/10" />
          <span className="relative z-10 flex items-center gap-2 text-white">
            <CircleCheck className={`text-emerald-400 ${iconSize}`} />
            {truncateAddress(publicKey)}
          </span>
        </button>
        <button
          onClick={disconnect}
          title="Disconnect wallet"
          className="relative group rounded-lg flex items-center p-2 transition-all duration-300 bg-black/30 backdrop-blur-sm border-2 border-red-500/60 hover:border-red-500"
        >
          <LogOut className="w-4 h-4 text-red-500" />
        </button>
      </div>
    );
  }

  // ── Reconnecting (silent restore on mount) ─────────────────────────────────
  if (isReconnecting) {
    return (
      <button
        disabled
        className={[
          'relative group rounded-lg font-medium flex items-center gap-2 transition-all duration-300 opacity-70 cursor-wait',
          sizeClasses[size],
          className,
        ].join(' ')}
      >
        <span className="absolute inset-0 rounded-lg bg-black/30 backdrop-blur-sm" />
        <span className="absolute inset-0 rounded-lg border-2 border-[#db74cf]/50" />
        <span className="relative z-10 flex items-center gap-2 text-white">
          <Spinner className={iconSize} />
          Reconnecting…
        </span>
      </button>
    );
  }

  // ── Trigger button + modal ─────────────────────────────────────────────────
  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className={[
          'relative group rounded-lg font-medium flex items-center gap-2 transition-all duration-300',
          sizeClasses[size],
          className,
        ].join(' ')}
      >
        <span className="absolute inset-0 rounded-lg bg-black/30 backdrop-blur-sm" />
        <span className="absolute inset-0 rounded-lg border-2 border-[#db74cf] border-opacity-70 group-hover:border-opacity-100 transition-all" />
        <span className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-md bg-[#db74cf]/10" />
        <span className="relative z-10 flex items-center gap-2 text-white">
          <Wallet
            className={`text-primary group-hover:text-white transition-colors ${iconSize}`}
          />
          Connect Wallet
        </span>
      </button>

      {/* ── Modal ─────────────────────────────────────────────────────────── */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="wallet-modal-title"
          className="fixed inset-0 z-[9999]"
          style={{
            backgroundColor: 'rgba(0,0,0,0.80)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsModalOpen(false);
          }}
        >
          {/* Centering wrapper */}
          <div className="flex min-h-full items-center justify-center p-4">
            <div
              className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d0d0f] shadow-2xl"
              style={{
                boxShadow:
                  '0 0 0 1px rgba(219,116,207,0.15), 0 32px 64px -16px rgba(0,0,0,0.9), 0 0 48px rgba(219,116,207,0.08)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Gradient tint */}
              <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-[#db74cf]/[0.08] via-transparent to-blue-600/[0.08]" />

              {/* Header */}
              <div className="relative flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/[0.08]">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#db74cf] to-blue-500 shadow-lg">
                    <Wallet className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h2
                      id="wallet-modal-title"
                      className="text-base font-semibold text-white leading-tight"
                    >
                      Connect Wallet
                    </h2>
                    <p className="text-xs text-white/40 mt-0.5">
                      Choose a wallet to continue
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/[0.08] transition-all"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="relative px-6 py-4 space-y-2">
                <ModalStateBanner
                  status={status}
                  error={error}
                  wasPreviouslyConnected={wasPreviouslyConnected}
                  lastWallet={lastWallet}
                  connectingWalletId={connectingWalletId}
                  onRetry={handleRetry}
                />

                {/* Wallet list — last used wallet floats to the top */}
                {[...WALLETS]
                  .sort((a, b) => {
                    if (a.id === lastWallet) return -1;
                    if (b.id === lastWallet) return 1;
                    return 0;
                  })
                  .map((wallet) => (
                    <WalletRow
                      key={wallet.id}
                      wallet={wallet}
                      isInstalled={installState[wallet.id]}
                      isConnecting={isConnecting && connectingWalletId === wallet.id}
                      isLastUsed={wallet.id === lastWallet}
                      onConnect={handleConnect}
                    />
                  ))}
              </div>

              {/* Footer */}
              <div className="relative px-6 pb-5 pt-3 border-t border-white/[0.08]">
                <p className="text-center text-[11px] text-white/30 leading-relaxed">
                  By connecting you agree to our{' '}
                  <span className="text-[#db74cf]/70 hover:text-[#db74cf] cursor-pointer transition-colors">
                    Terms of Service
                  </span>
                  . New to wallets?{' '}
                  <a
                    href="https://www.freighter.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#db74cf]/70 hover:text-[#db74cf] transition-colors"
                  >
                    Learn more
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
