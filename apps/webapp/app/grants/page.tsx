"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trophy, Users, Wallet, Clock, ChevronRight, Info } from "lucide-react";
import { useStellarConfig } from "@/contexts/StellarConfigContext";
import { useStellarWallet } from "@/app/providers";
import { signTransaction } from "@stellar/freighter-api";
import {
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { getExplorerUrl } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GrantRound {
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

interface ProjectQf {
  projectId: number;
  qfScore: string;
  totalContributions: string;
  contributorCount: number;
  estimatedMatch: string;
}

interface RoundSummary {
  round: GrantRound;
  poolBalance: string;
  projects: ProjectQf[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function formatAmount(raw: string, decimals = 7): string {
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

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLES[status] ?? "bg-white/5 text-white/40 border-white/10"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function RoundCard({ round }: { round: GrantRound }) {
  const endDate = new Date(round.endTime * 1000).toLocaleDateString();
  return (
    <Link
      href={`/grants/${round.id}`}
      className="group flex flex-col gap-4 p-5 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-base truncate">{round.name}</p>
        </div>
        <StatusBadge status={round.status} />
      </div>

      <div className="flex items-center gap-2">
        <Wallet className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="text-foreground/50 text-sm">Matching Pool</span>
        <span className="ml-auto font-bold text-sm">
          {formatAmount(round.totalPool)} XLM
        </span>
      </div>

      <div className="flex items-center gap-2 text-foreground/40 text-xs">
        <Clock className="w-3.5 h-3.5" />
        <span>Ends {endDate}</span>
        <ChevronRight className="w-3.5 h-3.5 ml-auto group-hover:translate-x-0.5 transition-transform" />
      </div>
    </Link>
  );
}

function QfBar({ share }: { share: number }) {
  return (
    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
      <div
        className="h-full rounded-full bg-primary transition-all duration-500"
        style={{ width: `${share}%` }}
      />
    </div>
  );
}

function ProjectAllocationRow({
  item,
  rank,
  poolBalance,
}: {
  item: ProjectQf;
  rank: number;
  poolBalance: string;
  key?: number;
}) {
  const share = matchShare(item.estimatedMatch, poolBalance);
  const rankColors = ["text-amber-400", "text-slate-400", "text-amber-700"];

  const { config } = useStellarConfig();
  const { publicKey, status: walletStatus, connect: connectWallet } = useStellarWallet();

  const [isExpanded, setIsExpanded] = useState(false);
  const [amount, setAmount] = useState("");
  const [txState, setTxState] = useState<
    "idle" | "building" | "simulating" | "signing" | "submitting" | "polling" | "success" | "error"
  >("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey || !config) return;

    setTxState("building");
    setErrorMsg(null);
    setTxHash(null);

    try {
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error("Please enter a valid amount greater than 0.");
      }

      // Convert to i128 (7 decimals for XLM/Soroban tokens)
      const amountRaw = BigInt(Math.round(parsedAmount * 10_000_000));

      const vaultContractId = config.contracts.crowdfundVault;
      if (!vaultContractId) {
        throw new Error("Crowdfund Vault contract ID is not configured.");
      }

      const rpcUrl = config.sorobanRpcUrl || "https://soroban-testnet.stellar.org";
      const networkPassphrase = config.networkPassphrase;

      // 1. Fetch account
      const server = new rpc.Server(rpcUrl);
      let sourceAccount;
      try {
        sourceAccount = await server.getAccount(publicKey);
      } catch (err) {
        throw new Error(
          "Failed to fetch account info from RPC. Make sure your account is active and funded on testnet (use Friendbot in Stellar Laboratory)."
        );
      }

      // 2. Build transaction
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

      // 3. Simulate
      setTxState("simulating");
      const simulation = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simulation)) {
        throw new Error(`Simulation failed: ${simulation.error}`);
      }

      const preparedTx = rpc.assembleTransaction(tx, simulation).build();

      // 4. Sign with Freighter
      setTxState("signing");
      const signingResult = await signTransaction(preparedTx.toXDR(), { networkPassphrase });
      if (signingResult.error) {
        throw new Error(`Signing failed: ${signingResult.error}`);
      }

      const signedTx = TransactionBuilder.fromXDR(signingResult.signedTxXdr, networkPassphrase);

      // 5. Submit
      setTxState("submitting");
      const sendResponse = await server.sendTransaction(signedTx);
      if (sendResponse.status === "ERROR") {
        throw new Error(`Submission failed: ${JSON.stringify(sendResponse.errorResult)}`);
      }

      // 6. Poll status
      setTxState("polling");
      const hash = sendResponse.hash;
      setTxHash(hash);
      const deadline = Date.now() + 45000; // 45s timeout for testnet

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
        <span className={`text-sm font-bold w-6 ${rankColors[rank] ?? "text-foreground/40"}`}>
          #{rank + 1}
        </span>
        <span className="flex-1 font-medium text-sm">Project #{item.projectId}</span>
        <span className="text-primary font-bold text-sm">
          ~{formatAmount(item.estimatedMatch)} XLM
        </span>
      </div>

      <QfBar share={share} />

      <div className="flex items-center justify-between gap-6 text-xs text-foreground/50">
        <div className="flex gap-6">
          <span>
            <span className="text-foreground font-semibold">{item.contributorCount}</span> contributors
          </span>
          <span>
            <span className="text-foreground font-semibold">
              {formatAmount(item.totalContributions)} XLM
            </span>{" "}
            contributed
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
                  
                  {/* Preset buttons */}
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
                    <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg leading-relaxed">
                      {errorMsg}
                    </div>
                  )}
                </>
              ) : txState === "success" ? (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-lg space-y-2">
                  <p className="font-bold flex items-center gap-1.5">
                    ✓ Contribution Successful!
                  </p>
                  <p>You have contributed {amount} XLM to Project #{item.projectId}.</p>
                  {txHash && (
                    <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-emerald-500/20 font-mono text-[10px]">
                      <span>Hash: {txHash.substring(0, 12)}...{txHash.substring(52)}</span>
                      <a
                        href={getExplorerUrl("tx", txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-bold"
                      >
                        View on Explorer ↗
                      </a>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setTxState("idle");
                      setAmount("");
                    }}
                    className="mt-2 text-foreground/50 hover:text-foreground text-[10px] underline"
                  >
                    Send another contribution
                  </button>
                </div>
              ) : (
                <div className="p-4 bg-white/5 border border-white/10 rounded-lg space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    <span className="text-xs text-white/80 font-medium">
                      {txState === "building" && "Preparing transaction..."}
                      {txState === "simulating" && "Simulating transaction..."}
                      {txState === "signing" && "Awaiting wallet signature..."}
                      {txState === "submitting" && "Submitting transaction..."}
                      {txState === "polling" && "Waiting for confirmation..."}
                    </span>
                  </div>
                  {txHash && (
                    <p className="text-[10px] text-foreground/40 font-mono">
                      Tx Hash: {txHash}
                    </p>
                  )}
                </div>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ── Round detail panel ────────────────────────────────────────────────────────

function RoundDetail({
  summary,
  onBack,
}: {
  summary: RoundSummary;
  onBack: () => void;
}) {
  const { round, poolBalance, projects } = summary;
  const startDate = new Date(round.startTime * 1000).toLocaleDateString();
  const endDate = new Date(round.endTime * 1000).toLocaleDateString();

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-foreground/50 hover:text-foreground transition-colors"
      >
        ← Back to rounds
      </button>

      <div className="flex items-start justify-between gap-4">
        <h2 className="text-2xl font-bold">{round.name}</h2>
        <StatusBadge status={round.status} />
      </div>

      {/* Pool card */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center">
        <p className="text-foreground/50 text-sm mb-1">Matching Pool</p>
        <p className="text-4xl font-extrabold tracking-tight">
          {formatAmount(poolBalance)} XLM
        </p>
        <p className="text-foreground/40 text-xs mt-2">
          Distributed proportionally via quadratic funding
        </p>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-3 gap-3 text-sm">
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

      {/* QF explanation */}
      <div className="flex gap-3 p-4 rounded-xl border border-primary/10 bg-primary/5 text-sm">
        <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
        <p className="text-foreground/60 leading-relaxed">
          Quadratic funding rewards projects with broad community support. A project with 100
          contributors of 1 XLM each receives more matching than one with a single 100 XLM donor.
          The formula is: <span className="font-mono text-foreground/80">(Σ √contribution)²</span>
        </p>
      </div>

      {/* Allocations */}
      <div>
        <h3 className="font-semibold text-base mb-3">Estimated Allocations</h3>
        {projects.length === 0 ? (
          <p className="text-foreground/40 text-sm text-center py-8">
            No eligible projects yet.
          </p>
        ) : (
          <div className="space-y-3">
            {projects.map((p, idx) => (
              <ProjectAllocationRow
                key={p.projectId}
                item={p}
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GrantsPage() {
  const [rounds, setRounds] = useState<GrantRound[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<RoundSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/grants/rounds`)
      .then((r) => r.json())
      .then((data: GrantRound[]) => setRounds(data))
      .catch(() => setError("Failed to load grant rounds."))
      .finally(() => setIsLoading(false));
  }, []);

  const openRound = async (roundId: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_BASE}/grants/rounds/${roundId}/summary`);
      const data: RoundSummary = await res.json();
      setSelectedSummary(data);
    } catch {
      setError("Failed to load round details.");
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <section className="relative pt-32 pb-16 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="container mx-auto max-w-4xl relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <Trophy className="w-7 h-7 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Grants</h1>
          </div>
          <p className="text-foreground/50 text-base max-w-xl leading-relaxed">
            Community-funded matching rounds using quadratic funding. More contributors means more
            matching — not just bigger donations.
          </p>
        </div>
      </section>

      <section className="px-4 pb-20">
        <div className="container mx-auto max-w-4xl">
          {isLoading || detailLoading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-20 text-foreground/40">{error}</div>
          ) : selectedSummary ? (
            <RoundDetail
              summary={selectedSummary}
              onBack={() => setSelectedSummary(null)}
            />
          ) : (
            <>
              {rounds.length === 0 ? (
                <div className="text-center py-20">
                  <Trophy className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
                  <p className="text-foreground/40">No grant rounds available yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {rounds.map((r: GrantRound) => (
                    <div key={r.id} onClick={() => void openRound(r.id)} className="cursor-pointer">
                      <RoundCard round={r} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
