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
  TrendingUp,
  BarChart3,
  Users,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clientConfig } from "@/lib/config";
import { useStellarWallet } from "@/app/providers";
import { useExplorerUrl } from "@/hooks/useExplorerUrl";
import { EmptyState } from "@/components/ui/empty-state";
import { ListError } from "@/components/ui/list-error";
import { ListSkeleton } from "@/components/ui/list-skeleton";
import { toast } from "sonner";

const API_BASE = clientConfig.apiUrl;

interface StreamState {
  beneficiary: string;
  totalAmount: string;
  claimedAmount: string;
  unlockedAmount: string;
  remainingAmount: string;
  startTime: number;
  duration: number;
}

interface StreamPreview {
  beneficiary: string;
  totalAmount: string;
  claimedAmount: string;
  unlockedAmount: string;
  remainingAmount: string;
  startTime: number;
  duration: number;
  previewAt: number;
  isActive: boolean;
}

interface BeneficiaryHistoryItem {
  id: string;
  oldBeneficiary: string;
  newBeneficiary: string | null;
  rotatedAt: string;
  rotatedBy: string;
  transactionHash: string;
}

interface BeneficiaryHistoryResponse {
  items: BeneficiaryHistoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
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

export default function TreasuryPage() {
  const params = useParams();
  const beneficiary = params.beneficiary as string;
  const { publicKey } = useStellarWallet();
  const buildExplorerUrl = useExplorerUrl();

  const [stream, setStream] = useState<StreamState | null>(null);
  const [preview, setPreview] = useState<StreamPreview | null>(null);
  const [history, setHistory] = useState<BeneficiaryHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "schedule" | "history">("overview");

  const fetchStream = async () => {
    try {
      const res = await fetch(`${API_BASE}/treasury/streams/${beneficiary}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("No treasury stream found for this beneficiary");
        throw new Error(`Failed to fetch stream (${res.status})`);
      }
      const data = await res.json();
      setStream(data);
    } catch (err) {
      console.error("Failed to fetch stream:", err);
    }
  };

  const fetchPreview = async () => {
    try {
      const res = await fetch(`${API_BASE}/treasury/streams/preview?beneficiary=${beneficiary}`);
      if (res.ok) {
        const data = await res.json();
        setPreview(data);
      }
    } catch (err) {
      console.warn("Failed to fetch preview:", err);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/treasury/streams/${beneficiary}/history`);
      if (res.ok) {
        const data: BeneficiaryHistoryResponse = await res.json();
        setHistory(data.items);
      }
    } catch (err) {
      console.warn("Failed to fetch history:", err);
    }
  };

  useEffect(() => {
    if (beneficiary) {
      setIsLoading(true);
      setError(null);
      Promise.all([fetchStream(), fetchPreview(), fetchHistory()]).finally(() =>
        setIsLoading(false)
      );
    }
  }, [beneficiary]);

  const isOwnStream = publicKey && publicKey.toLowerCase() === beneficiary.toLowerCase();
  const canClaim = stream && Number(stream.unlockedAmount) > Number(stream.claimedAmount);
  const isFullyClaimed = stream && Number(stream.remainingAmount) === 0;
  const isNotStarted = stream && Math.floor(Date.now() / 1000) < stream.startTime;
  const progress = stream ? getProgress(stream.totalAmount, stream.claimedAmount) : 0;
  const timeRemaining = stream ? getTimeRemaining(stream.startTime, stream.duration) : 0;
  const endTime = stream ? stream.startTime + stream.duration : 0;
  const endDate = stream ? formatDate(endTime) : "";
  const previewAmount = preview?.unlockedAmount || stream?.unlockedAmount || "0";
  const previewUnlocked = preview?.unlockedAmount || stream?.unlockedAmount || "0";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto max-w-5xl py-16 px-4">
          <ListSkeleton count={4} variant="grid" gridCols={1} />
        </div>
      </div>
    );
  }

  if (error || !stream) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto max-w-5xl py-16 px-4">
          <EmptyState
            icon={Shield}
            title="No treasury stream found"
            description="No treasury stream exists for this beneficiary address."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto max-w-5xl py-16 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold font-heading tracking-tight">
              Treasury Stream
            </h1>
            <p className="text-foreground/50 mt-1 font-mono text-sm">
              {formatAmount(stream.totalAmount)} XLM total allocation
            </p>
          </div>
          {isOwnStream && publicKey && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
              <Unlock className="w-3 h-3" />
              Your Stream
            </span>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <p className="text-foreground/50 text-sm">Total Allocated</p>
                <p className="font-bold text-2xl text-primary">{formatAmount(stream.totalAmount)} XLM</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-foreground/50 text-sm">Claimed</p>
                <p className="font-bold text-2xl text-emerald-400">
                  {formatAmount(stream.claimedAmount)} XLM
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                <Unlock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-foreground/50 text-sm">Unlocked</p>
                <p className="font-bold text-2xl text-blue-400">
                  {formatAmount(previewUnlocked)} XLM
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-foreground/10 text-foreground/60">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-foreground/50 text-sm">Remaining</p>
                <p className="font-bold text-2xl">{formatAmount(stream.remainingAmount)} XLM</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl border border-white/5 bg-white/[0.02]">
          {[
            { id: "overview", label: "Overview", icon: BarChart3 },
            { id: "schedule", label: "Schedule", icon: Calendar },
            { id: "history", label: "History", icon: Users },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-white/5 text-foreground"
                  : "text-foreground/50 hover:text-foreground"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-6">
            {/* Progress Overview */}
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-foreground/60 text-sm">Stream Progress</span>
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
            </div>

            {/* Timeline */}
            <div className="border-t border-white/5 pt-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary" />
                Stream Timeline
              </h3>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                  <div className="p-3 rounded-xl bg-primary/10 text-primary">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <p className="text-foreground/50 text-sm">Start Date</p>
                    <p className="font-medium">{formatDate(stream.startTime)}</p>
                    {isNotStarted && (
                      <p className="text-amber-400 text-xs mt-1">Stream has not started yet</p>
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
                    <p className="text-foreground/50 text-sm">Currently Unlocked</p>
                    <p className="font-medium text-emerald-400">{formatAmount(previewUnlocked)} XLM</p>
                    <p className="text-foreground/40 text-xs mt-1">
                      Claimed: {formatAmount(stream.claimedAmount)} XLM
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-foreground/20" />
                </div>
              </div>
            </div>

            {/* Claim Section */}
            <div className="border-t border-white/5 pt-6">
              <h3 className="text-lg font-semibold mb-4">Claim Unlocked Funds</h3>
              {isFullyClaimed ? (
                <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-emerald-400">Fully Claimed</p>
                    <p className="text-foreground/50 text-sm">
                      All {formatAmount(stream.totalAmount)} XLM has been claimed from this stream.
                    </p>
                  </div>
                </div>
              ) : isNotStarted ? (
                <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 flex items-center gap-3">
                  <Clock className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-amber-400">Stream Not Started</p>
                    <p className="text-foreground/50 text-sm">
                      Stream begins on {formatDate(stream.startTime)}. Funds unlock linearly over time.
                    </p>
                  </div>
                </div>
              ) : !canClaim ? (
                <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] flex items-center gap-3">
                  <Info className="w-5 h-5 text-foreground/40 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Nothing to Claim</p>
                    <p className="text-foreground/50 text-sm">
                      All currently unlocked funds have been claimed. Check back as more funds unlock.
                    </p>
                  </div>
                </div>
              ) : !isOwnStream ? (
                <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] flex items-center gap-3">
                  <Lock className="w-5 h-5 text-foreground/40 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Connect Beneficiary Wallet</p>
                    <p className="text-foreground/50 text-sm">
                      Connect the wallet matching this beneficiary address to claim.
                    </p>
                  </div>
                </div>
              ) : (
                <button
                  className="w-full px-6 py-3 rounded-lg font-semibold text-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors"
                  onClick={() => toast.info("Claim functionality requires backend integration")}
                >
                  Claim {formatAmount(
                    String(Number(previewUnlocked) - Number(stream.claimedAmount))
                  )} XLM
                  <ArrowUpRight className="w-5 h-5 ml-2 inline" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Schedule Tab */}
        {activeTab === "schedule" && preview && (
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              Unlock Schedule Preview
            </h3>
            <p className="text-foreground/50 text-sm">
              Linear vesting schedule showing unlocked amounts over time. Preview calculated at{" "}
              {formatDateTime(preview.previewAt)}.
            </p>

            {/* Installment Table */}
            <div className="overflow-x-auto rounded-xl border border-white/5">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/[0.02] border-b border-white/5">
                  <tr>
                    <th className="px-6 py-4 font-medium text-foreground/50">Installment</th>
                    <th className="px-6 py-4 font-medium text-foreground/50">Date</th>
                    <th className="px-6 py-4 font-medium text-foreground/50 text-right">
                      Unlocked Amount
                    </th>
                    <th className="px-6 py-4 font-medium text-foreground/50 text-right">
                      Cumulative
                    </th>
                    <th className="px-6 py-4 font-medium text-foreground/50 text-right">
                      % of Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {Array.from({ length: 12 }, (_, i) => {
                    const installment = i + 1;
                    const date = new Date(
                      (stream.startTime + (stream.duration / 12) * installment) * 1000
                    );
                    const unlocked = Math.floor(
                      (Number(stream.totalAmount) * installment) / 12
                    );
                    const cumulative = Math.floor(
                      (Number(stream.totalAmount) * installment) / 12
                    );
                    const pct = ((installment / 12) * 100).toFixed(1);
                    const isPast = date.getTime() < Date.now();
                    const isCurrent =
                      date.getTime() >= Date.now() &&
                      (i === 11 || new Date(
                        (stream.startTime + (stream.duration / 12) * (installment + 1)) * 1000
                      ).getTime() > Date.now());

                    return (
                      <tr
                        key={installment}
                        className={cn(
                          "transition-colors",
                          isPast && "bg-emerald-500/5",
                          isCurrent && "bg-primary/5"
                        )}
                      >
                        <td className="px-6 py-4">
                          <span
                            className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold",
                              isPast
                                ? "bg-emerald-500/10 text-emerald-400"
                                : isCurrent
                                ? "bg-primary/10 text-primary"
                                : "bg-white/5 text-foreground/40"
                            )}
                          >
                            #{installment}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-mono text-sm">
                          {date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                        <td className="px-6 py-4 text-right font-mono">
                          {formatAmount(String(unlocked - (installment > 1 ? Math.floor(Number(stream.totalAmount) * (installment - 1) / 12) : 0)))} XLM
                        </td>
                        <td className="px-6 py-4 text-right font-mono">
                          {formatAmount(String(cumulative))} XLM
                        </td>
                        <td className="px-6 py-4 text-right text-foreground/50">{pct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-white/5">
              <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                <p className="text-foreground/50 text-sm">Total Stream</p>
                <p className="font-semibold text-xl">{formatAmount(stream.totalAmount)} XLM</p>
              </div>
              <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                <p className="text-foreground/50 text-sm">Duration</p>
                <p className="font-semibold text-xl">
                  {Math.round(stream.duration / 86400)} days
                </p>
              </div>
              <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                <p className="text-foreground/50 text-sm">Installments</p>
                <p className="font-semibold text-xl">12 monthly</p>
              </div>
            </div>
          </div>
        )}

        {/* History Tab */}
        {activeTab === "history" && (
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              Beneficiary History
            </h3>
            {history.length === 0 ? (
              <EmptyState
                icon={Info}
                title="No history available"
                description="No beneficiary rotations have been recorded for this stream."
              />
            ) : (
              <div className="space-y-3">
                {history.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 p-4 rounded-xl border border-white/5 bg-white/[0.02]"
                  >
                    <div
                      className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"
                    >
                      <Shield className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">
                        Beneficiary rotated #{history.length - index}
                      </p>
                      <p className="text-foreground/50 text-xs mt-1 font-mono">
                        {formatDateTime(new Date(item.rotatedAt).getTime() / 1000)}
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-xs text-foreground/50">
                        <span className="font-mono text-foreground/40">
                          {formatAddress(item.oldBeneficiary)}
                        </span>
                        <ChevronRight className="w-3 h-3" />
                        <span className="font-mono text-primary">
                          {item.newBeneficiary
                            ? formatAddress(item.newBeneficiary)
                            : "Removed"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={buildExplorerUrl.tx(item.transactionHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View Tx
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Info Card */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 space-y-3">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Info className="w-5 h-5 text-primary" />
            How Treasury Streams Work
          </h3>
          <div className="space-y-2 text-sm text-foreground/60">
            <p>
              <span className="font-medium">Linear Vesting:</span> Funds unlock linearly over the
              stream duration. You can claim unlocked amounts at any time.
            </p>
            <p>
              <span className="font-medium">Cliff Support:</span> Streams can have an initial cliff
              period where no funds unlock until the cliff date passes.
            </p>
            <p>
              <span className="font-medium">Beneficiary Rotation:</span> Admins can rotate the
              beneficiary while preserving accrued claim state. History is audit-logged on-chain.
            </p>
            <p>
              <span className="font-medium">Preview Endpoint:</span> The schedule preview shows
              exact unlock amounts at any point in time without submitting transactions.
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