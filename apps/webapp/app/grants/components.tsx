"use client";

import { useState } from "react";
import Link from "next/link";
import { Wallet, Info, Bookmark } from "lucide-react";
import { useStellarConfig } from "@/contexts/StellarConfigContext";
import { useStellarWallet } from "@/app/providers";
import { useWatchlist } from "@/contexts/WatchlistContext";
import { TransactionReceiptModal } from "@/components/TransactionReceiptModal";
import { signTransaction } from "@stellar/freighter-api";
import { Address, Contract, TransactionBuilder, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { useExplorerUrl } from "@/hooks/useExplorerUrl";

export interface GrantRound {
  id: number;
  name: string;
  tokenAddress: string;
  startTime: number;
  endTime: number;
  totalPool: string;
  isFinalized: boolean;
  isDistributed: boolean;
  status: "PENDING" | "ACTIVE" | "ENDED" | "FINALIZED" | "DISTRIBUTED";
}

export interface ProjectQf {
  projectId: number;
  qfScore: string;
  totalContributions: string;
  contributorCount: number;
  estimatedMatch: string;
}

export interface RoundSummary {
  round: GrantRound;
  poolBalance: string;
  projects: ProjectQf[];
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  PENDING: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  ENDED: "bg-white/5 text-white/40 border-white/10",
  FINALIZED: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  DISTRIBUTED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  PENDING: "Upcoming",
  ENDED: "Ended",
  FINALIZED: "Finalized",
  DISTRIBUTED: "Distributed",
};

export function formatAmount(raw: string, decimals = 7): string {
  const n = Number(raw) / Math.pow(10, decimals);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

function matchShare(estimatedMatch: string, poolBalance: string): number {
  const pool = Number(poolBalance);
  if (pool === 0) return 0;
  return Math.min(100, (Number(estimatedMatch) / pool) * 100);
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLES[status] ?? "bg-white/5 text-white/40 border-white/10"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function RoundCard({ round }: { round: GrantRound }) {
  const endDate = new Date(round.endTime * 1000).toLocaleDateString();
  const { isProjectSaved, toggleSavedProject } = useWatchlist();
  const isSaved = isProjectSaved(round.id);

  return (
    <div
      className="group relative flex flex-col gap-4 p-5 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-all cursor-pointer"
    >
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleSavedProject(round.id);
          }}
          className={`p-2 rounded-full transition-colors ${
            isSaved ? "bg-primary/20 text-primary" : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white"
          }`}
          aria-label={isSaved ? "Remove from watchlist" : "Add to watchlist"}
        >
          <Bookmark className="w-4 h-4" fill={isSaved ? "currentColor" : "none"} />
        </button>
      </div>

      <Link href={`/grants/${round.id}`} className="absolute inset-0 z-0" aria-label={`View ${round.name}`} />

      <div className="flex items-start justify-between gap-3 pointer-events-none relative z-10 mr-12">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-base truncate">{round.name}</p>
        </div>
        <StatusBadge status={round.status} />
      </div>

      <div className="flex items-center gap-2 pointer-events-none relative z-10">
        <Wallet className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="text-foreground/50 text-sm">Matching Pool</span>
        <span className="ml-auto font-bold text-sm">{formatAmount(round.totalPool)} XLM</span>
      </div>

      <div className="flex items-center gap-2 text-foreground/40 text-xs pointer-events-none relative z-10">
        <span>Ends {endDate}</span>
      </div>
    </div>
  );
}

export function RoundTable({ rounds }: { rounds: GrantRound[] }) {
  const { isProjectSaved, toggleSavedProject } = useWatchlist();

  return (
    <div className="hidden md:block w-full overflow-x-auto rounded-2xl border border-white/5 bg-white/[0.02]">
      <table className="w-full text-left text-sm whitespace-nowrap min-w-[800px]">
        <thead className="bg-white/[0.02] border-b border-white/5">
          <tr>
            <th className="px-6 py-4 font-medium text-foreground/50 w-12"></th>
            <th className="px-6 py-4 font-medium text-foreground/50">Name</th>
            <th className="px-6 py-4 font-medium text-foreground/50">Status</th>
            <th className="px-6 py-4 font-medium text-foreground/50 text-right">Matching Pool</th>
            <th className="px-6 py-4 font-medium text-foreground/50">Ends</th>
            <th className="px-6 py-4 font-medium text-foreground/50 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rounds.map((round) => {
            const endDate = new Date(round.endTime * 1000).toLocaleDateString();
            const isSaved = isProjectSaved(round.id);

            return (
              <tr key={round.id} className="group hover:bg-white/[0.05] transition-colors relative">
                <td className="px-6 py-4 relative z-10">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      toggleSavedProject(round.id);
                    }}
                    className={`p-2 -ml-2 rounded-full transition-colors ${
                      isSaved ? "bg-primary/20 text-primary" : "text-white/40 hover:bg-white/10 hover:text-white"
                    }`}
                    aria-label={isSaved ? "Remove from watchlist" : "Add to watchlist"}
                  >
                    <Bookmark className="w-4 h-4" fill={isSaved ? "currentColor" : "none"} />
                  </button>
                </td>
                <td className="px-6 py-4 font-semibold relative">
                  <Link href={`/grants/${round.id}`} className="absolute inset-0 z-0" aria-label={`View ${round.name}`} />
                  <div className="flex items-center gap-2 max-w-[200px] lg:max-w-xs xl:max-w-md truncate pointer-events-none relative z-10">
                    {round.name}
                  </div>
                </td>
                <td className="px-6 py-4 pointer-events-none relative z-10">
                  <StatusBadge status={round.status} />
                </td>
                <td className="px-6 py-4 text-right pointer-events-none relative z-10">
                  <div className="flex items-center justify-end gap-2">
                    <Wallet className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="font-bold">{formatAmount(round.totalPool)} XLM</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-foreground/60 text-xs pointer-events-none relative z-10">
                  {endDate}
                </td>
                <td className="px-6 py-4 text-right relative z-20">
                  <Link 
                    href={`/grants/${round.id}`} 
                    className="inline-flex items-center justify-center px-4 py-2 text-xs font-bold rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    View Details
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function QfBar({ share }: { share: number }) {
  return (
    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
      <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${share}%` }} />
    </div>
  );
}

export function ProjectAllocationRow({
  item,
  rank,
  poolBalance,
}: {
  item: ProjectQf;
  rank: number;
  poolBalance: string;
}) {
  const share = matchShare(item.estimatedMatch, poolBalance);
  const rankColors = ["text-amber-400", "text-slate-400", "text-amber-700"];

  const { config } = useStellarConfig();
  const { publicKey, status: walletStatus, connect: connectWallet } = useStellarWallet();
  const buildExplorerUrl = useExplorerUrl();

  const [isExpanded, setIsExpanded] = useState(false);
  const [amount, setAmount] = useState("");
  const [txState, setTxState] = useState<
    "idle" | "building" | "simulating" | "signing" | "submitting" | "polling" | "success" | "error"
  >("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey || !config) return;

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
      const vaultContractId = config.contracts.crowdfundVault;
      if (!vaultContractId) {
        throw new Error("Crowdfund Vault contract ID is not configured.");
      }

      const rpcUrl = config.sorobanRpcUrl || "https://soroban-testnet.stellar.org";
      const networkPassphrase = config.networkPassphrase;

      const server = new rpc.Server(rpcUrl);
      let sourceAccount;
      try {
        sourceAccount = await server.getAccount(publicKey);
      } catch (err) {
        throw new Error(
          "Failed to fetch account info from RPC. Make sure your account is active and funded on testnet (use Friendbot in Stellar Laboratory)."
        );
      }

      const contract = new Contract(vaultContractId);
      const operation = contract.call(
        "deposit",
        Address.fromString(publicKey).toScVal(),
        nativeToScVal(BigInt(item.projectId), { type: "u64" }),
        nativeToScVal(amountRaw, { type: "i128" })
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
      const signingResult = await signTransaction(preparedTx.toXDR(), { networkPassphrase });
      if (signingResult.error) {
        throw new Error(`Signing failed: ${signingResult.error}`);
      }

      const signedTx = TransactionBuilder.fromXDR(signingResult.signedTxXdr, networkPassphrase);
      setTxState("submitting");
      const sendResponse = await server.sendTransaction(signedTx);
      if (sendResponse.status === "ERROR") {
        throw new Error(`Submission failed: ${JSON.stringify(sendResponse.errorResult)}`);
      }

      setTxState("polling");
      const hash = sendResponse.hash;
      setTxHash(hash);
      const deadline = Date.now() + 45000;

      while (Date.now() < deadline) {
        const getResponse = await server.getTransaction(hash);
        if (getResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          setTxState("success");
          return;
        }
        if (getResponse.status === rpc.Api.GetTransactionStatus.FAILED) {
          throw new Error(`Transaction failed on-chain: ${hash}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      throw new Error("Transaction timed out waiting for confirmation.");
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Failed to submit contribution.");
      setTxState("error");
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl border border-white/5 bg-white/[0.02]">
      <div className="flex items-center gap-3">
        <span className={`text-sm font-bold w-6 ${rankColors[rank] ?? "text-foreground/40"}`}>#{rank + 1}</span>
        <span className="flex-1 font-medium text-sm">Project #{item.projectId}</span>
        <span className="text-primary font-bold text-sm">~{formatAmount(item.estimatedMatch)} XLM</span>
      </div>

      <QfBar share={share} />

      <div className="flex items-center justify-between gap-6 text-xs text-foreground/50">
        <div className="flex gap-6">
          <span>
            <span className="text-foreground font-semibold">{item.contributorCount}</span> contributors
          </span>
          <span>
            <span className="text-foreground font-semibold">{formatAmount(item.totalContributions)} XLM</span> contributed
          </span>
          <span>
            <span className="text-foreground font-semibold">{share.toFixed(1)}%</span> of pool
          </span>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`px-3 py-1 rounded-lg border text-xs font-bold transition-all ${
            isExpanded
              ? "bg-white/10 border-white/20 text-white"
              : "bg-primary/10 border-primary/20 text-primary hover:bg-primary/20"
          }`}
        >
          {isExpanded ? "Close" : "Contribute"}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-2 p-4 rounded-xl border border-white/10 bg-white/[0.01] backdrop-blur-md space-y-4 transition-all duration-300">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white/80">Contribute to Project #{item.projectId}</h4>
            {config?.contracts?.crowdfundVault && (
              <a
                href={buildExplorerUrl("contract", config.contracts.crowdfundVault)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-primary/60 hover:text-primary underline underline-offset-2 transition-colors"
                title="View Crowdfund Vault contract on explorer"
              >
                Vault ↗
              </a>
            )}
          </div>

          {!publicKey ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <p className="text-xs text-foreground/50">Connect your Stellar wallet to make a contribution on testnet.</p>
              <button
                onClick={connectWallet}
                className="px-4 py-2 bg-primary hover:bg-primary/80 text-black text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Wallet className="w-3.5 h-3.5" />
                Connect Wallet
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              {txState === "idle" || txState === "error" ? (
                <>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="any"
                      min="0.0000001"
                      required
                      placeholder="Amount in XLM"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-primary/50"
                    />
                    <button
                      type="submit"
                      className="px-5 py-2 bg-primary hover:bg-primary/95 text-black text-sm font-bold rounded-lg transition-all"
                    >
                      Send
                    </button>
                  </div>

                  <div className="flex gap-2">
                    {[10, 50, 100, 500].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAmount(String(preset))}
                        className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded text-xs border border-white/5 transition-all"
                      >
                        {preset} XLM
                      </button>
                    ))}
                  </div>

                  {txState === "error" && errorMsg && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg leading-relaxed mt-2">
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
                        {txState === "success" && "Contribution Confirmed!"}
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
                      }}
                      className="text-foreground/50 hover:text-foreground text-[10px] underline"
                    >
                      Send another contribution
                    </button>
                  )}
                </div>
              )}
            </form>
          )}
        </div>
      )}

      {showReceiptModal && (
        <TransactionReceiptModal
          isOpen={showReceiptModal}
          onOpenChange={(open) => {
            setShowReceiptModal(open);
            if (!open && txState === "error") setTxState("idle");
          }}
          status={txState === "success" ? "confirmed" : txState === "error" ? "error" : "pending"}
          txHash={txHash}
          amount={amount}
          projectId={item.projectId}
        />
      )}
    </div>
  );
}

export function RoundDetail({ summary, onBack }: { summary: RoundSummary; onBack?: () => void }) {
  const { round, poolBalance, projects } = summary;
  const startDate = new Date(round.startTime * 1000).toLocaleDateString();
  const endDate = new Date(round.endTime * 1000).toLocaleDateString();

  return (
    <div className="space-y-6">
      {onBack ? (
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-foreground/50 hover:text-foreground transition-colors"
        >
          ← Back to rounds
        </button>
      ) : (
        <Link href="/grants" className="flex items-center gap-2 text-sm text-foreground/50 hover:text-foreground transition-colors">
          ← Back to rounds
        </Link>
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{round.name}</h2>
          <p className="text-foreground/50 text-sm mt-1">Round ID: {round.id}</p>
        </div>
        <StatusBadge status={round.status} />
      </div>

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center">
        <p className="text-foreground/50 text-sm mb-1">Matching Pool</p>
        <p className="text-4xl font-extrabold tracking-tight">{formatAmount(poolBalance)} XLM</p>
        <p className="text-foreground/40 text-xs mt-2">Distributed proportionally via quadratic funding.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        {[
          { label: "Start", value: startDate },
          { label: "End", value: endDate },
          { label: "Projects", value: String(projects.length) },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center"
          >
            <p className="text-foreground/40 text-xs mb-1">{label}</p>
            <p className="font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3 p-4 rounded-xl border border-primary/10 bg-primary/5 text-sm">
        <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
        <p className="text-foreground/60 leading-relaxed">
          Quadratic funding rewards projects with broad community support. A project with 100 contributors of 1 XLM each receives more matching than one with a single 100 XLM donor. The formula is: <span className="font-mono text-foreground/80">(Σ √contribution)²</span>
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-base mb-3">Estimated Allocations</h3>
        {projects.length === 0 ? (
          <p className="text-foreground/40 text-sm text-center py-8">No eligible projects yet.</p>
        ) : (
          <div className="space-y-3">
            {projects.map((project, idx) => (
              <ProjectAllocationRow
                key={project.projectId}
                item={project}
                rank={idx}
                poolBalance={poolBalance}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
