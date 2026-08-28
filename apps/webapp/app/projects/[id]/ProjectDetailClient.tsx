"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Wallet,
  Users,
  Calendar,
  CheckCircle,
  Clock,
  AlertCircle,
  TrendingUp,
  Target,
  Award,
  Bookmark,
  ExternalLink,
  Info,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
} from "lucide-react";
import { DependencyStatusBanner } from "@/components/DependencyStatusBanner";
import { useWatchlist } from "@/hooks/use-watchlist";
import { useStellarWallet } from "@/app/providers";
import { useStellarConfig } from "@/contexts/StellarConfigContext";
import { useWalletReadiness } from "@/hooks/useWalletReadiness";
import { WalletReadinessBanner } from "@/components/WalletReadinessBanner";
import { TransactionReceiptModal } from "@/components/TransactionReceiptModal";
import { ReportButton } from "@/components/report/report-button";
import { signTransaction } from "@stellar/freighter-api";
import {
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { useExplorerUrl } from "@/hooks/useExplorerUrl";

import { clientConfig } from "@/lib/config";

const API_BASE = clientConfig.apiUrl;

// Types
export interface ProjectMilestone {
  id: string;
  title: string;
  description: string;
  targetDate: string;
  isCompleted: boolean;
  completedAt?: string;
  fundingReleaseAmount?: string;
  fundingReleaseTx?: string;
}

export interface ProjectContributor {
  publicKey: string;
  totalContributed: string;
  contributionCount: number;
  lastContributionAt: string;
}

export interface ProjectDetail {
  id: number;
  owner: string;
  name: string;
  description?: string;
  bannerUrl?: string;
  targetAmount: string;
  tokenAddress: string;
  contractAddress?: string;
  totalDeposited: string;
  totalWithdrawn: string;
  isActive: boolean;
  onChainStatus: "ACTIVE" | "COMPLETED" | "PAUSED" | "CANCELLED";
  lastSyncedAt: string;
  contributorCount: number;
  roadmap: ProjectMilestone[];
  createdAt: string;
}

type TransactionStatus =
  | "idle"
  | "building"
  | "simulating"
  | "signing"
  | "submitting"
  | "polling"
  | "success"
  | "error";

export interface ProjectBalance {
  balance: string;
}

export interface ContributionRecord {
  projectId: number;
  contributor: string;
  amount: string;
  timestamp: string;
  transactionHash: string;
}

// Helper functions
function formatXLM(amount: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return "0.00";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateWithTime(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getProgressPercentage(current: string, target: string): number {
  const currentNum = parseFloat(current);
  const targetNum = parseFloat(target);
  if (targetNum === 0) return 0;
  return Math.min(100, (currentNum / targetNum) * 100);
}

function getStatusColor(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "COMPLETED":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "PAUSED":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "CANCELLED":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    default:
      return "bg-white/5 text-white/40 border-white/10";
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "COMPLETED":
      return "Completed";
    case "PAUSED":
      return "Paused";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

// Components
function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getStatusColor(status)}`}
    >
      {getStatusLabel(status)}
    </span>
  );
}

function ProgressBar({ percentage }: { percentage: number }) {
  return (
    <div className="w-full h-3 rounded-full bg-white/5 overflow-hidden relative">
      <div
        className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-1000 ease-out"
        style={{ width: `${percentage}%` }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-semibold text-white/80">
          {percentage.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground/70 transition-colors"
      aria-label={`Copy ${label || "address"}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function MilestoneTimeline({ milestones }: { milestones: ProjectMilestone[] }) {
  if (!milestones || milestones.length === 0) {
    return (
      <div className="text-center py-8 text-foreground/40 text-sm">
        No milestones defined for this project.
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-4 top-0 bottom-0 w-px bg-white/10" />

      <div className="space-y-6">
        {milestones.map((milestone, index) => {
          const isCompleted = milestone.isCompleted;
          const targetDate = new Date(milestone.targetDate);
          const isPast = targetDate < new Date();

          return (
            <div key={milestone.id} className="relative pl-10">
              {/* Timeline dot */}
              <div
                className={`absolute left-2.5 top-1 w-3.5 h-3.5 rounded-full border-2 ${
                  isCompleted
                    ? "bg-emerald-500 border-emerald-500"
                    : isPast
                      ? "bg-amber-500/30 border-amber-500/30"
                      : "bg-white/20 border-white/20"
                }`}
              >
                {isCompleted && (
                  <CheckCircle className="absolute -top-0.5 -left-0.5 w-4 h-4 text-emerald-400" />
                )}
              </div>

              <div
                className={`p-4 rounded-xl border ${
                  isCompleted
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : isPast
                      ? "border-amber-500/20 bg-amber-500/5"
                      : "border-white/5 bg-white/[0.02]"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm text-white">
                      {milestone.title}
                    </h4>
                    <p className="text-xs text-foreground/50 mt-1 line-clamp-2">
                      {milestone.description}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-foreground/40">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(milestone.targetDate)}
                      </span>
                      {isCompleted && milestone.completedAt && (
                        <span className="flex items-center gap-1 text-emerald-400/60">
                          <CheckCircle className="w-3 h-3" />
                          Completed {formatDate(milestone.completedAt)}
                        </span>
                      )}
                      {!isCompleted && isPast && (
                        <span className="flex items-center gap-1 text-amber-400/60">
                          <Clock className="w-3 h-3" />
                          Overdue
                        </span>
                      )}
                    </div>
                    {milestone.fundingReleaseAmount && (
                      <div className="mt-2 inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        <Wallet className="w-3 h-3" />
                        {formatXLM(milestone.fundingReleaseAmount)} XLM released
                      </div>
                    )}
                  </div>
                  <StatusBadge
                    status={
                      isCompleted ? "COMPLETED" : isPast ? "PAUSED" : "ACTIVE"
                    }
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ContributorList({
  contributors,
}: {
  contributors: ProjectContributor[];
}) {
  const [expanded, setExpanded] = useState(false);
  const displayCount = expanded ? contributors.length : 5;

  if (!contributors || contributors.length === 0) {
    return (
      <div className="text-center py-8 text-foreground/40 text-sm">
        No contributors yet. Be the first to contribute!
      </div>
    );
  }

  const sortedContributors = [...contributors].sort(
    (a, b) => parseFloat(b.totalContributed) - parseFloat(a.totalContributed),
  );

  return (
    <div className="space-y-2">
      {sortedContributors.slice(0, displayCount).map((contributor, index) => (
        <div
          key={contributor.publicKey}
          className="flex items-center justify-between p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-bold text-foreground/40 w-5">
              #{index + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-white/80 truncate">
                  {contributor.publicKey.slice(0, 6)}...
                  {contributor.publicKey.slice(-6)}
                </span>
                <CopyButton
                  text={contributor.publicKey}
                  label="contributor address"
                />
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-foreground/40">
                <span>{contributor.contributionCount} contributions</span>
                <span>Last: {formatDate(contributor.lastContributionAt)}</span>
              </div>
            </div>
          </div>
          <div className="text-right font-semibold text-sm text-primary whitespace-nowrap">
            {formatXLM(contributor.totalContributed)} XLM
          </div>
        </div>
      ))}

      {contributors.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground/70 transition-colors mx-auto mt-3"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              Show {contributors.length - 5} more contributors
            </>
          )}
        </button>
      )}
    </div>
  );
}

function ContributionForm({
  projectId,
  projectName,
  vaultAddress,
  onContributionSuccess,
}: {
  projectId: number;
  projectName: string;
  vaultAddress?: string;
  onContributionSuccess?: () => void;
}) {
  const { config } = useStellarConfig();
  const {
    publicKey,
    status: walletStatus,
    connect: connectWallet,
  } = useStellarWallet();
  const buildExplorerUrl = useExplorerUrl();

  const [amount, setAmount] = useState("");
  const [txState, setTxState] = useState<TransactionStatus>("idle");

  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  const readiness = useWalletReadiness({ amount });
  const isWalletReady = readiness.ready;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (readiness.blocker) {
      setErrorMsg(readiness.blocker.guidance);
      setTxState("error");
      setShowReceiptModal(true);
      return;
    }

    if (!publicKey || !config) {
      setErrorMsg("Wallet not connected or configuration missing.");
      setTxState("error");
      setShowReceiptModal(true);
      return;
    }

    if (!vaultAddress) {
      setErrorMsg("Vault address not configured for this project.");
      setTxState("error");
      setShowReceiptModal(true);
      return;
    }

    setTxState("building");
    setErrorMsg(null);
    setTxHash(null);
    setShowReceiptModal(true);

    try {
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error("Please enter a valid amount greater than 0.");
      }

      const amountRaw = BigInt(Math.round(parsedAmount * 10_000_000));
      const rpcUrl =
        config.sorobanRpcUrl || "https://soroban-testnet.stellar.org";
      const networkPassphrase = config.networkPassphrase;

      const server = new rpc.Server(rpcUrl);
      let sourceAccount;
      try {
        sourceAccount = await server.getAccount(publicKey);
      } catch {
        throw new Error(
          "Failed to fetch account info from RPC. Make sure your account is active and funded on testnet.",
        );
      }

      const contract = new Contract(vaultAddress);
      const operation = contract.call(
        "deposit",
        Address.fromString(publicKey).toScVal(),
        nativeToScVal(BigInt(projectId), { type: "u64" }),
        nativeToScVal(amountRaw, { type: "i128" }),
      );

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100000",
        networkPassphrase,
      })
        .addOperation(operation)
        .setTimeout(60)
        .build();

      setTxState("simulating");
      const simulation = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simulation)) {
        throw new Error(`Simulation failed: ${simulation.error}`);
      }

      const preparedTx = rpc.assembleTransaction(tx, simulation).build();
      setTxState("signing");
      const signingResult = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase,
      });
      if (signingResult.error) {
        throw new Error(`Signing failed: ${signingResult.error}`);
      }

      const signedTx = TransactionBuilder.fromXDR(
        signingResult.signedTxXdr,
        networkPassphrase,
      );
      setTxState("submitting");
      const sendResponse = await server.sendTransaction(signedTx);

      if (sendResponse.status === "ERROR") {
        throw new Error(
          `Submission failed: ${JSON.stringify(sendResponse.errorResult)}`,
        );
      }

      const hash = sendResponse.hash;
      setTxHash(hash);

      setTxState("polling");
      const deadline = Date.now() + 45000;

      while (Date.now() < deadline) {
        const getResponse = await server.getTransaction(hash);
        if (getResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          setTxState("success");
          onContributionSuccess?.();
          return;
        }
        if (getResponse.status === rpc.Api.GetTransactionStatus.FAILED) {
          setErrorMsg(`Transaction failed on-chain: ${hash}`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      setErrorMsg(
        "The transaction was submitted, but confirmation was not received within 45 seconds.",
      );
      return;
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Failed to submit contribution.");
      setTxState("error");
    }
  };

  return (
    <div className="space-y-4">
      {!publicKey ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm text-foreground/50">
            Connect your Stellar wallet to contribute to {projectName}.
          </p>
          <button
            onClick={connectWallet}
            className="px-6 py-2.5 bg-primary hover:bg-primary/80 text-black text-sm font-bold rounded-lg transition-colors flex items-center gap-2"
          >
            <Wallet className="w-4 h-4" />
            Connect Wallet
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {txState === "idle" || txState === "error" ? (
            <>
              <div>
                <label
                  htmlFor="contribution-amount"
                  className="block text-xs font-medium text-foreground/50 mb-1.5"
                >
                  Amount (XLM)
                </label>
                <div className="flex gap-2">
                  <input
                    id="contribution-amount"
                    type="number"
                    step="any"
                    min="0.0000001"
                    required
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-primary/50 transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={!isWalletReady}
                    aria-disabled={!isWalletReady}
                    title={
                      readiness.blocker ? readiness.blocker.guidance : undefined
                    }
                    className="px-6 py-2.5 bg-primary hover:bg-primary/95 disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-bold rounded-lg transition-all whitespace-nowrap"
                  >
                    Contribute
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {[10, 50, 100, 500].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(String(preset))}
                    className="px-3 py-1 bg-white/5 hover:bg-white/10 text-foreground/60 hover:text-white rounded-lg text-xs border border-white/5 transition-all"
                  >
                    {preset} XLM
                  </button>
                ))}
              </div>

              <WalletReadinessBanner issues={readiness.issues} />

              {txState === "error" && errorMsg && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg leading-relaxed">
                  {errorMsg}
                </div>
              )}
            </>
          ) : (
            <div className="p-4 bg-white/5 border border-white/10 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {txState === "success" ? null : (
                    <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  )}
                  <span className="text-xs text-white/80 font-medium">
                    {txState === "building" && "Preparing transaction..."}
                    {txState === "simulating" && "Simulating transaction..."}
                    {txState === "signing" && "Awaiting wallet signature..."}
                    {txState === "submitting" && "Submitting transaction..."}
                    {txState === "polling" && "Waiting for confirmation..."}
                    {txState === "success" && "Contribution Confirmed! 🎉"}
                  </span>
                </div>
                {txState === "success" && (
                  <button
                    type="button"
                    onClick={() => setShowReceiptModal(true)}
                    className="text-xs text-primary hover:underline font-bold"
                  >
                    View Receipt
                  </button>
                )}
              </div>
              {txState === "success" && (
                <button
                  type="button"
                  onClick={() => {
                    setTxState("idle");
                    setAmount("");
                    setErrorMsg(null);
                  }}
                  className="text-foreground/50 hover:text-foreground text-[10px] underline"
                >
                  Contribute again
                </button>
              )}
            </div>
          )}

          {vaultAddress && config?.contracts?.crowdfundVault && (
            <div className="flex items-center justify-end">
              <a
                href={buildExplorerUrl("contract", vaultAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-foreground/40 hover:text-primary transition-colors flex items-center gap-1"
              >
                View vault contract
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </form>
      )}

      {showReceiptModal && (
        <TransactionReceiptModal
          isOpen={showReceiptModal}
          onOpenChange={(open) => {
            setShowReceiptModal(open);
            if (!open && txState === "error") setTxState("idle");
          }}
          status={
            txState === "success"
              ? "confirmed"
              : txState === "error"
                ? "error"
                : "pending"
          }
          txHash={txHash}
          amount={amount}
          projectId={projectId}
        />
      )}
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
        <AlertCircle className="w-8 h-8 text-red-400" />
      </div>
      <h3 className="text-lg font-semibold text-white/80">
        Unable to load project
      </h3>
      <p className="text-sm text-foreground/50 mt-2 max-w-md">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-6 px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Try Again
        </button>
      )}
      <Link
        href="/grants"
        className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to grants
      </Link>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-white/5 rounded-lg" />
      <div className="h-64 bg-white/5 rounded-2xl" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="h-24 bg-white/5 rounded-xl" />
        <div className="h-24 bg-white/5 rounded-xl" />
        <div className="h-24 bg-white/5 rounded-xl" />
      </div>
      <div className="h-96 bg-white/5 rounded-2xl" />
    </div>
  );
}

// Main Component
export default function ProjectDetailClient({
  projectId,
}: {
  projectId: number;
}) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [balance, setBalance] = useState<ProjectBalance | null>(null);
  const [contributors, setContributors] = useState<ProjectContributor[]>([]);
  const [myContributions, setMyContributions] = useState<ContributionRecord[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showContributors, setShowContributors] = useState(false);
  const [showMyContributions, setShowMyContributions] = useState(false);

  const { isProjectSaved, toggleSavedProject } = useWatchlist();
  const { publicKey } = useStellarWallet();
  const isSaved = isProjectSaved(projectId);

  const fetchProjectData = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const [projectRes, balanceRes, contributorsRes] = await Promise.all([
        fetch(`${API_BASE}/crowdfund/projects/${projectId}`),
        fetch(`${API_BASE}/crowdfund/projects/${projectId}/balance`),
        fetch(`${API_BASE}/crowdfund/projects/${projectId}/contributors`),
      ]);

      if (!projectRes.ok) {
        if (projectRes.status === 404) {
          setError("Project not found");
          return;
        }
        throw new Error(`Failed to load project: ${projectRes.statusText}`);
      }

      const projectData = await projectRes.json();
      const balanceData = await balanceRes.json();
      const contributorsData = await contributorsRes.json();

      setProject(projectData);
      setBalance(balanceData);
      setContributors(contributorsData);

      // Fetch my contributions if wallet is connected
      if (publicKey) {
        try {
          const myContribRes = await fetch(
            `${API_BASE}/crowdfund/projects/${projectId}/contributions/${publicKey}`,
          );
          if (myContribRes.ok) {
            const myData = await myContribRes.json();
            setMyContributions(myData);
          }
        } catch {
          // Silently fail for my contributions
        }
      }

      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load project details");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [projectId, publicKey]);

  useEffect(() => {
    fetchProjectData();
  }, [fetchProjectData]);

  const handleContributionSuccess = () => {
    fetchProjectData();
  };

  const handleToggleWatchlist = () => {
    toggleSavedProject(projectId);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <section className="relative pt-24 pb-8 px-4">
          <div className="container mx-auto max-w-4xl">
            <LoadingState />
          </div>
        </section>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <section className="relative pt-24 pb-8 px-4">
          <div className="container mx-auto max-w-4xl">
            <ErrorState
              message={error || "Project not found"}
              onRetry={fetchProjectData}
            />
          </div>
        </section>
      </div>
    );
  }

  const progressPercentage = getProgressPercentage(
    project.totalDeposited,
    project.targetAmount,
  );
  const isCompleted = project.onChainStatus === "COMPLETED";
  const isActive = project.isActive && project.onChainStatus === "ACTIVE";
  const canContribute = isActive && !isCompleted;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <section className="relative pt-24 pb-8 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />

        <div className="container mx-auto max-w-4xl relative z-10">
          <div className="flex items-center justify-between gap-4 mb-4">
            <Link
              href="/grants"
              className="inline-flex items-center gap-2 text-sm text-foreground/50 hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to grants
            </Link>
            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleWatchlist}
                className={`p-2 rounded-full transition-colors ${
                  isSaved
                    ? "bg-primary/20 text-primary"
                    : "bg-white/5 text-foreground/40 hover:bg-white/10 hover:text-white"
                }`}
                aria-label={
                  isSaved ? "Remove from watchlist" : "Add to watchlist"
                }
              >
                <Bookmark
                  className="w-4 h-4"
                  fill={isSaved ? "currentColor" : "none"}
                />
              </button>
              <ReportButton
                targetType="project"
                targetId={String(project.id)}
                targetLabel={project.name}
                variant="icon"
                className="!p-2 bg-white/5 hover:bg-red-500/10"
              />
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                  {project.name}
                </h1>
                <StatusBadge status={project.onChainStatus} />
              </div>
              {project.description && (
                <p className="text-foreground/60 text-base mt-2 max-w-2xl leading-relaxed">
                  {project.description}
                </p>
              )}
              <div className="flex items-center gap-4 mt-3 text-sm text-foreground/40">
                <span className="flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  {contributors.length} contributors
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  Created {formatDate(project.createdAt)}
                </span>
                {project.contractAddress && (
                  <span className="flex items-center gap-1">
                    <Wallet className="w-4 h-4" />
                    <span className="font-mono text-xs">
                      {project.contractAddress.slice(0, 8)}...
                    </span>
                    <CopyButton
                      text={project.contractAddress}
                      label="contract address"
                    />
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className="px-4 pb-20">
        <div className="container mx-auto max-w-4xl">
          <div className="mt-2">
            <DependencyStatusBanner />
          </div>

          {/* Progress Section */}
          <div className="mt-6 p-6 rounded-2xl border border-white/5 bg-white/[0.02]">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground/60">
                    Funding Progress
                  </span>
                  <span className="text-sm font-bold">
                    {formatXLM(project.totalDeposited)} /{" "}
                    {formatXLM(project.targetAmount)} XLM
                  </span>
                </div>
                <ProgressBar percentage={progressPercentage} />
                <div className="flex items-center justify-between mt-2 text-xs text-foreground/40">
                  <span>{progressPercentage.toFixed(1)}% funded</span>
                  <span>Target: {formatXLM(project.targetAmount)} XLM</span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div className="text-center">
                  <p className="text-foreground/40 text-xs">Raised</p>
                  <p className="font-bold text-primary">
                    {formatXLM(project.totalDeposited)} XLM
                  </p>
                </div>
                <div className="w-px h-10 bg-white/10" />
                <div className="text-center">
                  <p className="text-foreground/40 text-xs">Withdrawn</p>
                  <p className="font-bold text-foreground/60">
                    {formatXLM(project.totalWithdrawn)} XLM
                  </p>
                </div>
              </div>
            </div>

            {/* Contribution Form */}
            {canContribute && (
              <div className="mt-6 pt-6 border-t border-white/5">
                <h3 className="text-sm font-semibold mb-4">
                  Contribute to this project
                </h3>
                <ContributionForm
                  projectId={project.id}
                  projectName={project.name}
                  vaultAddress={project.contractAddress}
                  onContributionSuccess={handleContributionSuccess}
                />
              </div>
            )}

            {isCompleted && (
              <div className="mt-6 pt-6 border-t border-white/5">
                <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-emerald-400">
                      Funding Complete!
                    </p>
                    <p className="text-xs text-emerald-400/60">
                      This project has reached its funding target. Thank you to
                      all contributors!
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
            <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] text-center">
              <p className="text-foreground/40 text-xs mb-1">Total Raised</p>
              <p className="text-xl font-bold">
                {formatXLM(project.totalDeposited)} XLM
              </p>
            </div>
            <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] text-center">
              <p className="text-foreground/40 text-xs mb-1">Contributors</p>
              <p className="text-xl font-bold">{contributors.length}</p>
            </div>
            <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] text-center">
              <p className="text-foreground/40 text-xs mb-1">Milestones</p>
              <p className="text-xl font-bold">
                {project.roadmap.filter((m) => m.isCompleted).length} /{" "}
                {project.roadmap.length}
              </p>
            </div>
          </div>

          {/* My Contributions */}
          {publicKey && myContributions.length > 0 && (
            <div className="mt-6">
              <button
                onClick={() => setShowMyContributions(!showMyContributions)}
                className="flex items-center justify-between w-full p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
              >
                <span className="font-semibold text-sm flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-primary" />
                  My Contributions ({myContributions.length})
                </span>
                {showMyContributions ? (
                  <ChevronUp className="w-4 h-4 text-foreground/40" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-foreground/40" />
                )}
              </button>
              {showMyContributions && (
                <div className="mt-3 space-y-2">
                  {myContributions.map((contrib, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 rounded-lg border border-white/5 bg-white/[0.02]"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {formatXLM(contrib.amount)} XLM
                        </p>
                        <p className="text-xs text-foreground/40">
                          {formatDateWithTime(contrib.timestamp)}
                        </p>
                      </div>
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${contrib.transactionHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        View transaction
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Milestone Timeline */}
          <div className="mt-6 p-6 rounded-2xl border border-white/5 bg-white/[0.02]">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold">Milestone Timeline</h3>
              </div>
              <span className="text-xs text-foreground/40">
                {project.roadmap.filter((m) => m.isCompleted).length} of{" "}
                {project.roadmap.length} completed
              </span>
            </div>
            <MilestoneTimeline milestones={project.roadmap} />
          </div>

          {/* Contributors */}
          <div className="mt-6 p-6 rounded-2xl border border-white/5 bg-white/[0.02]">
            <button
              onClick={() => setShowContributors(!showContributors)}
              className="flex items-center justify-between w-full"
            >
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold">Top Contributors</h3>
                <span className="text-xs text-foreground/40">
                  ({contributors.length})
                </span>
              </div>
              {showContributors ? (
                <ChevronUp className="w-4 h-4 text-foreground/40" />
              ) : (
                <ChevronDown className="w-4 h-4 text-foreground/40" />
              )}
            </button>
            {showContributors && (
              <div className="mt-4">
                <ContributorList contributors={contributors} />
              </div>
            )}
          </div>

          {/* Info Footer */}
          <div className="mt-6 flex items-center justify-between text-xs text-foreground/30 border-t border-white/5 pt-6">
            <div className="flex items-center gap-1">
              <Info className="w-3 h-3" />
              <span>
                Last synced: {formatDateWithTime(project.lastSyncedAt)}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span>Project ID: #{project.id}</span>
              <span>Token: {project.tokenAddress.slice(0, 8)}...</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
