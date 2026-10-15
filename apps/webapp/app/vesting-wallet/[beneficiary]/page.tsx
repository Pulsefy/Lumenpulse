"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Calendar,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Info,
  ChevronRight,
  ExternalLink,
  Lock,
  Unlock,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clientConfig } from "@/lib/config";
import { useStellarWallet } from "@/app/providers";
import { signTransaction } from "@stellar/freighter-api";
import { Address, Contract, TransactionBuilder, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { useExplorerUrl } from "@/hooks/useExplorerUrl";
import { EmptyState } from "@/components/ui/empty-state";
import { ListError } from "@/components/ui/list-error";
import { ListSkeleton } from "@/components/ui/list-skeleton";
import { toast } from "sonner";

const API_BASE = clientConfig.apiUrl;

interface VestingSchedule {
  beneficiary: string;
  totalAmount: string;
  claimedAmount: string;
  claimableAmount: string;
  remainingAmount: string;
  startTime: number;
  duration: number;
  hasMilestoneRequirement: boolean;
  vaultContract: string | null;
  projectId: number | null;
  milestoneId: number | null;
}

interface ClaimablePreview {
  beneficiary: string;
  totalAmount: string;
  claimedAmount: string;
  claimableAmount: string;
  remainingAmount: string;
  startTime: number;
  duration: number;
  previewAt: number;
  isActive: boolean;
}

function formatAmount(raw: string, decimals = 7): string {
  const n = Number(raw) / Math.pow(10, decimals);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(decimals);
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getProgress(total: string, claimed: string): number {
  const t = Number(total);
  const c = Number(claimed);
  if (t === 0) return 0;
  return Math.min(100, Math.round((c / t) * 100));
}

function getTimeRemaining(startTime: number, duration: number): number {
  const endTime = startTime + duration;
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, endTime - now);
}

function getTimeRemainingString(seconds: number): string {
  if (seconds <= 0) return "Completed";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h remaining`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m remaining`;
}

export default function VestingWalletPage() {
  const params = useParams();
  const beneficiary = params.beneficiary as string;
  const { publicKey, connect: connectWallet } = useStellarWallet();
  const buildExplorerUrl = useExplorerUrl();

  const [schedule, setSchedule] = useState<VestingSchedule | null>(null);
  const [preview, setPreview] = useState<ClaimablePreview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [txState, setTxState] = useState<
    "idle" | "building" | "simulating" | "signing" | "submitting" | "polling" | "success" | "error"
  >("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  const fetchSchedule = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/vesting-wallet/vesting/${beneficiary}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("No vesting schedule found for this beneficiary");
        throw new Error(`Failed to fetch vesting schedule (${res.status})`);
      }
      const data = await res.json();
      setSchedule(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load vesting schedule");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPreview = async () => {
    try {
      const res = await fetch(`${API_BASE}/vesting-wallet/vesting/${beneficiary}/claimable`);
      if (res.ok) {
        const data = await res.json();
        setPreview(data);
      }
    } catch (err) {
      console.warn("Failed to fetch claimable preview:", err);
    }
  };

  useEffect(() => {
    if (beneficiary) {
      fetchSchedule();
      fetchPreview();
    }
  }, [beneficiary]);

  const isOwnSchedule = publicKey && publicKey.toLowerCase() === beneficiary.toLowerCase();
  const canClaim = schedule && Number(schedule.claimableAmount) > 0;
  const isFullyClaimed = schedule && Number(schedule.remainingAmount) === 0;
  const isNotStarted = schedule && Math.floor(Date.now() / 1000) < schedule.startTime;
  const progress = schedule ? getProgress(schedule.totalAmount, schedule.claimedAmount) : 0;
  const timeRemaining = schedule ? getTimeRemaining(schedule.startTime, schedule.duration) : 0;
  const endTime = schedule ? schedule.startTime + schedule.duration : 0;
  const endDate = schedule ? formatDate(endTime) : "";
  const previewAmount = preview?.claimableAmount || schedule.claimableAmount;
  const previewUnlocked = preview?.unlockedAmount || schedule.claimableAmount;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto max-w-3xl py-16 px-4">
          <ListSkeleton count={3} variant="grid" gridCols={1} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto max-w-3xl py-16 px-4">
          <ListError message={error} onRetry={fetchSchedule} />
        </div>
      </div>
    );
  }

  if (!schedule) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto max-w-3xl py-16 px-4">
          <EmptyState
            icon={Lock}
            title="No vesting schedule found"
            description="No vesting schedule exists for this beneficiary address."
          />
        </div>
      </div>
    );
  }

  const previewAmount = preview?.claimableAmount || schedule.claimableAmount;
  const previewUnlocked = preview?.unlockedAmount || schedule.claimableAmount;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto max-w-3xl py-16 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold font-heading tracking-tight">
              Vesting Schedule
            </h1>
            <p className="text-foreground/50 mt-1 font-mono text-sm">
              {formatAmount(schedule.totalAmount)} XLM total allocation
            </p>
          </div>
          {isOwnSchedule && publicKey && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
              <Unlock className="w-3 h-3" />
              Your Schedule
            </span>
          )}
        </div>

        {/* Main Schedule Card */}
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-6">
          {/* Progress Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-foreground/60 text-sm">Vesting Progress</span>
                  <span className="text-lg font-bold font-mono text-primary">{progress}%</span>
                </div>
                <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${progress}%`,
                      background: `linear-gradient(90deg, theme('colors.primary'), theme('colors.purple-400'))`,
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                  <p className="text-foreground/40 text-xs">Total Allocated</p>
                  <p className="font-semibold text-lg">{formatAmount(schedule.totalAmount)} XLM</p>
                </div>
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                  <p className="text-foreground/40 text-xs">Claimed</p>
                  <p className="font-semibold text-lg text-emerald-400">
                    {formatAmount(schedule.claimedAmount)} XLM
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                  <p className="text-foreground/40 text-xs">Remaining</p>
                  <p className="font-semibold text-lg text-foreground/60">
                    {formatAmount(schedule.remainingAmount)} XLM
                  </p>
                </div>
              </div>
            </div>
            <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] text-center">
              <div className="text-3xl font-bold font-mono text-primary mb-1">
                {formatAmount(previewAmount)} XLM
              </div>
              <p className="text-foreground/50 text-sm">Currently Claimable</p>
              {preview && preview.previewAt !== schedule.startTime + schedule.duration && (
                <p className="text-xs text-foreground/40 mt-1">
                  As of {formatDateTime(preview.previewAt)}
                </p>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="border-t border-white/5 pt-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              Vesting Timeline
            </h3>
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                <div className="p-3 rounded-xl bg-primary/10 text-primary">
                  <Calendar className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="text-foreground/50 text-sm">Start Date</p>
                  <p className="font-medium">{formatDate(schedule.startTime)}</p>
                  {isNotStarted && (
                    <p className="text-amber-400 text-xs mt-1">Vesting has not started yet</p>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-foreground/20" />
              </div>
              <div className="flex items-center gap-4 p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="text-foreground/50 text-sm">End Date</p>
                  <p className="font-medium">{endDate}</p>
                  <p className="text-foreground/40 text-xs mt-1">{getTimeRemainingString(timeRemaining)}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-foreground/20" />
              </div>
              <div className="flex items-center gap-4 p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400">
                  <Unlock className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="text-foreground/50 text-sm">Claimable Amount</p>
                  <p className="font-medium text-emerald-400">{formatAmount(previewAmount)} XLM</p>
                  {preview && preview.unlockedAmount !== preview.claimableAmount && (
                    <p className="text-foreground/40 text-xs mt-1">
                      Unlocked: {formatAmount(preview.unlockedAmount)} XLM
                    </p>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-foreground/20" />
              </div>
            </div>
          </div>

          {/* Milestone Info */}
          {schedule.hasMilestoneRequirement && (
            <div className="border-t border-white/5 pt-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-400" />
                Milestone-Gated Vesting
              </h3>
              <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 space-y-2">
                <p className="text-foreground/60">
                  This vesting schedule is gated by a crowdfund vault milestone. Funds become
                  claimable only when the associated project milestone is completed and verified.
                </p>
                {schedule.vaultContract && (
                  <div className="flex items-center gap-2 text-sm text-foreground/50 font-mono">
                    <span>Vault:</span>
                    <a
                      href={buildExplorerUrl.contract(schedule.vaultContract)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {formatAddress(schedule.vaultContract)}
                    </a>
                  </div>
                )}
                {schedule.projectId && (
                  <div className="flex items-center gap-2 text-sm text-foreground/50">
                    <span>Project ID:</span>
                    <code className="font-mono bg-white/5 px-1.5 py-0.5 rounded">
                      {schedule.projectId}
                    </code>
                  </div>
                )}
                {schedule.milestoneId !== null && (
                  <div className="flex items-center gap-2 text-sm text-foreground/50">
                    <span>Milestone ID:</span>
                    <code className="font-mono bg-white/5 px-1.5 py-0.5 rounded">
                      {schedule.milestoneId}
                    </code>
                  </div>
                )}
                {canClaim && !isFullyClaimed && (
                  <p className="text-emerald-400 text-sm mt-2">
                    Milestone requirements met — {formatAmount(previewAmount)} XLM available to claim.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Claim Action */}
          <div className="border-t border-white/5 pt-6">
            <h3 className="text-lg font-semibold mb-4">Claim</h3>
            {isFullyClaimed ? (
              <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="font-medium text-emerald-400">Fully Claimed</p>
                  <p className="text-foreground/50 text-sm">
                    All {formatAmount(schedule.totalAmount)} XLM has been claimed from this schedule.
                  </p>
                </div>
              </div>
            ) : isNotStarted ? (
              <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 flex items-center gap-3">
                <Clock className="w-5 h-5 text-amber-400 flex-shrink-0" />
                <div>
                  <p className="font-medium text-amber-400">Vesting Not Started</p>
                  <p className="text-foreground/50 text-sm">
                    Vesting begins on {formatDate(schedule.startTime)}. Check back then to claim.
                  </p>
                </div>
              </div>
            ) : !canClaim ? (
              <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] flex items-center gap-3">
                <Info className="w-5 h-5 text-foreground/40 flex-shrink-0" />
                <div>
                  <p className="font-medium">Nothing to Claim Yet</p>
                  <p className="text-foreground/50 text-sm">
                    No funds have unlocked since your last claim. Check back later.
                  </p>
                </div>
              </div>
            ) : !isOwnSchedule ? (
              <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] flex items-center gap-3">
                <Lock className="w-5 h-5 text-foreground/40 flex-shrink-0" />
                <div>
                  <p className="font-medium">Connect Your Wallet</p>
                  <p className="text-foreground/50 text-sm">
                    Connect the wallet matching this beneficiary address to claim.
                  </p>
                </div>
              </div>
            ) : (
              <button
                onClick={handleClaim}
                disabled={txState !== "idle"}
                className={cn(
                  "w-full px-6 py-3 rounded-lg font-semibold text-lg transition-colors",
                  txState === "idle"
                    ? "bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20"
                    : "opacity-50 cursor-not-allowed"
                )}
              >
                {txState === "building" && (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Building transaction...
                  </>
                )}
                {txState === "simulating" && (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Simulating...
                  </>
                )}
                {txState === "signing" && (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Waiting for wallet signature...
                  </>
                )}
                {txState === "submitting" && (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Submitting to network...
                  </>
                )}
                {txState === "polling" && (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Waiting for confirmation...
                  </>
                )}
                {txState === "success" && (
                  <>
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    Claim Successful!
                  </>
                )}
                {txState === "error" && (
                  <>
                    <XCircle className="w-5 h-5 mr-2" />
                    Failed - Try Again
                  </>
                )}
                {txState === "idle" && (
                  <>
                    Claim {formatAmount(previewAmount)} XLM
                    <ArrowUpRight className="w-5 h-5 ml-2 inline" />
                  </>
                )}
              </button>
            )}
          </div>

          {/* Transaction Receipt Modal */}
          {showReceiptModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
              <div className="w-full max-w-md rounded-2xl border border-white/10 bg-background p-6 space-y-4">
                {txState === "success" ? (
                  <>
                    <div className="text-center">
                      <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                      <h3 className="text-xl font-semibold">Claim Successful!</h3>
                      <p className="text-foreground/50 text-sm mt-1">
                        Your vesting claim has been confirmed on-chain.
                      </p>
                    </div>
                    {txHash && (
                      <div className="p-4 rounded-lg bg-white/[0.02] border border-white/5 space-y-2">
                        <p className="text-xs text-foreground/40 font-mono">Transaction Hash</p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-sm font-mono truncate">{txHash}</code>
                          <a
                            href={buildExplorerUrl.tx(txHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3 inline mr-1" />
                            View
                          </a>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setShowReceiptModal(false);
                        setTxState("idle");
                      }}
                      className="w-full px-4 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors"
                    >
                      Close
                    </button>
                  </>
                ) : txState === "error" ? (
                  <>
                    <div className="text-center">
                      <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                      <h3 className="text-xl font-semibold">Claim Failed</h3>
                      <p className="text-foreground/50 text-sm mt-1">
                        {errorMsg || "An unknown error occurred"}
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setShowReceiptModal(false);
                          setTxState("idle");
                        }}
                        className="flex-1 px-4 py-2 rounded-lg border border-white/10 text-foreground/60 hover:bg-white/5 transition-colors"
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={() => {
                          setTxState("idle");
                          setErrorMsg(null);
                        }}
                        className="flex-1 px-4 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors"
                      >
                        Try Again
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <Loader2 className="w-10 h-10 animate-spin mx-auto mb-3 text-primary" />
                    <p className="text-foreground/60">
                      {txState === "building" && "Building transaction..."}
                      {txState === "simulating" && "Simulating transaction..."}
                      {txState === "signing" && "Please sign in your wallet..."}
                      {txState === "submitting" && "Submitting to network..."}
                      {txState === "polling" && "Waiting for confirmation..."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Info Card */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 space-y-3">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Info className="w-5 h-5 text-primary" />
            How Vesting Works
          </h3>
          <div className="space-y-2 text-sm text-foreground/60">
            <p>
              <span className="font-medium">Linear Vesting:</span> Funds unlock linearly over the
              vesting duration. You can claim unlocked amounts at any time.
            </p>
            {schedule.hasMilestoneRequirement && (
              <p>
                <span className="font-medium">Milestone-Gated:</span> This schedule is linked to a
                crowdfund project milestone. Funds only unlock when the milestone is verified as
                complete.
              </p>
            )}
            <p>
              <span className="font-medium">Gasless Claims:</span> Claims are submitted through
              your connected Stellar wallet (Freighter) using standard Soroban transactions.
            </p>
            <p>
              <span className="font-medium">No Expiry:</span> Unclaimed funds remain available
              indefinitely — you can claim them whenever convenient.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatAddress(address: string): string {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}