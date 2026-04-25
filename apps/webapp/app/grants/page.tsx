"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trophy, Users, Wallet, Clock, ChevronRight, Info } from "lucide-react";

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

      <div className="flex gap-6 text-xs text-foreground/50">
        <span>
          <span className="text-foreground font-semibold">{item.contributorCount}</span> contributors
        </span>
        <span>
          <span className="text-foreground font-semibold">
            {formatAmount(item.totalContributions)} XLM
          </span>{" "}
          contributed
        </span>
        <span className="ml-auto">
          <span className="text-foreground font-semibold">{share.toFixed(1)}%</span> of pool
        </span>
      </div>
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
