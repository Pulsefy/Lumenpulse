"use client";

import { RefreshCw, TrendingUp, TrendingDown, BarChart2, Wallet } from "lucide-react";
import type {
  PortfolioSummaryResponse,
  PortfolioPerformanceResponse,
  TimeWindowPerformance,
} from "@/lib/api-services";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value);
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WindowRow({ w }: { w: TimeWindowPerformance }) {
  const positive = (w.absolutePnl ?? 0) >= 0;
  const labelMap: Record<string, string> = {
    "24h": "24 Hours",
    "7d": "7 Days",
    "30d": "30 Days",
  };

  if (!w.hasData) {
    return (
      <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
        <span className="text-sm text-gray-400">{labelMap[w.window] ?? w.window}</span>
        <span className="text-xs text-gray-600 italic">Insufficient history</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <div>
        <p className="text-sm text-gray-300 font-medium">{labelMap[w.window] ?? w.window}</p>
        {w.baselineValueUsd !== null && (
          <p className="text-[11px] text-gray-600 mt-0.5">
            {formatUsd(w.baselineValueUsd)} → {formatUsd(w.currentValueUsd)}
          </p>
        )}
      </div>
      <div className="text-right">
        <p
          className={`text-sm font-semibold flex items-center justify-end gap-1 ${
            positive ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          {formatPct(w.percentageChange)}
        </p>
        <p className={`text-[11px] mt-0.5 ${positive ? "text-emerald-500/70" : "text-rose-500/70"}`}>
          {positive ? "+" : ""}{formatUsd(w.absolutePnl)}
        </p>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-1 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex justify-between items-center py-3 border-b border-white/5 last:border-0">
          <div className="space-y-1.5">
            <div className="h-4 w-20 bg-white/10 rounded" />
            <div className="h-3 w-32 bg-white/5 rounded" />
          </div>
          <div className="text-right space-y-1.5">
            <div className="h-4 w-16 bg-white/10 rounded ml-auto" />
            <div className="h-3 w-12 bg-white/5 rounded ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface MarketInsightsCardProps {
  publicKey: string | null;
  summary: PortfolioSummaryResponse | null;
  performance: PortfolioPerformanceResponse | null;
  isLoading: boolean;
  error: string | null;
  isFresh: boolean | null;
  lastUpdatedLabel: string | null;
  refresh: () => void;
}

export default function MarketInsightsCard({
  publicKey,
  summary,
  performance,
  isLoading,
  error,
  isFresh,
  lastUpdatedLabel,
  refresh,
}: MarketInsightsCardProps) {
  // Header (always rendered)
  const header = (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <BarChart2 className="w-4 h-4 text-violet-400" />
        <h2 className="text-xl font-semibold">Market Insights</h2>
      </div>
      <div className="flex items-center gap-2">
        {lastUpdatedLabel && (
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
              isFresh
                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                : "text-amber-400 bg-amber-500/10 border-amber-500/20"
            }`}
          >
            {isFresh ? `Updated ${lastUpdatedLabel}` : `Stale — ${lastUpdatedLabel}`}
          </span>
        )}
        <button
          id="market-insights-refresh-btn"
          onClick={refresh}
          disabled={isLoading}
          title="Refresh performance data"
          className="p-1 rounded-md text-gray-500 hover:text-gray-300 hover:bg-white/5 disabled:opacity-40 transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );

  // ── No wallet ─────────────────────────────────────────────────────────
  if (!publicKey) {
    return (
      <>
        {header}
        <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
          <div className="w-10 h-10 rounded-full bg-violet-500/10 flex items-center justify-center border border-violet-500/20">
            <Wallet className="w-4 h-4 text-violet-400" />
          </div>
          <p className="text-sm text-gray-400">Connect your wallet to see performance insights</p>
        </div>
      </>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading && !performance) {
    return (
      <>
        {header}
        <Skeleton />
      </>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────
  if (error && !performance) {
    return (
      <>
        {header}
        <div className="py-6 text-center">
          <p className="text-sm text-gray-400">{error}</p>
          <button
            id="market-insights-retry-btn"
            onClick={refresh}
            className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
          >
            Retry
          </button>
        </div>
      </>
    );
  }

  // ── No linked account yet ──────────────────────────────────────────────
  if (summary && !summary.hasLinkedAccount) {
    return (
      <>
        {header}
        <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
          <div className="w-10 h-10 rounded-full bg-violet-500/10 flex items-center justify-center border border-violet-500/20">
            <Wallet className="w-4 h-4 text-violet-400" />
          </div>
          <p className="text-sm text-gray-300 font-medium">Link a wallet to track performance</p>
          <p className="text-xs text-gray-600 max-w-[220px] leading-relaxed">
            Performance windows appear after you link an account and snapshot tracking begins.
          </p>
        </div>
      </>
    );
  }

  // ── First-time user: wallet linked, but no snapshot yet ───────────────
  if (summary?.hasLinkedAccount && !summary.lastUpdated) {
    return (
      <>
        {header}
        <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
          <div className="w-10 h-10 rounded-full bg-violet-500/10 flex items-center justify-center border border-violet-500/20">
            <BarChart2 className="w-4 h-4 text-violet-400" />
          </div>
          <p className="text-sm text-gray-300 font-medium">Waiting for your first snapshot</p>
          <p className="text-xs text-gray-600 max-w-[220px] leading-relaxed">
            Performance trends start populating after the first portfolio snapshot is recorded.
          </p>
        </div>
      </>
    );
  }

  // ── No performance history yet ─────────────────────────────────────────
  const hasAnyData = performance?.windows.some((w) => w.hasData);
  if (!performance || !hasAnyData) {
    return (
      <>
        {header}
        <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
          <div className="w-10 h-10 rounded-full bg-violet-500/10 flex items-center justify-center border border-violet-500/20">
            <BarChart2 className="w-4 h-4 text-violet-400" />
          </div>
          <p className="text-sm text-gray-400 font-medium">No history yet</p>
          <p className="text-xs text-gray-600 max-w-[200px] leading-relaxed">
            Performance data builds up over time as daily snapshots accumulate.
          </p>
        </div>
      </>
    );
  }

  // ── Populated ─────────────────────────────────────────────────────────
  return (
    <>
      {header}
      <p className="text-xs text-gray-500 mb-1">
        Current value:{" "}
        <span className="text-gray-300 font-semibold">
          {formatUsd(performance.currentValueUsd)}
        </span>
      </p>
      <div className="mt-2">
        {performance.windows.map((w) => (
          <WindowRow key={w.window} w={w} />
        ))}
      </div>
    </>
  );
}
