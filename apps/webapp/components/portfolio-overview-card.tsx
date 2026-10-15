"use client";

import { RefreshCw, TrendingUp, TrendingDown, Wallet, AlertCircle, Zap } from "lucide-react";
import type { PortfolioSummaryResponse, PortfolioPerformanceResponse, AllocationAsset } from "@/lib/api-services";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ASSET_COLOURS: Record<string, string> = {
  XLM: "#7C3AED",
  USDC: "#2563EB",
  BTC: "#D97706",
  ETH: "#6D28D9",
  AQUA: "#0891B2",
  yXLM: "#059669",
};

function assetColour(code: string, idx: number): string {
  return (
    ASSET_COLOURS[code] ??
    [
      "#7C3AED", "#2563EB", "#D97706", "#0891B2", "#059669",
      "#DC2626", "#9333EA", "#0284C7",
    ][idx % 8]
  );
}

function formatUsd(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: num >= 1000 ? 0 : 2,
  }).format(num);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FreshnessBadge({
  isFresh,
  label,
}: {
  isFresh: boolean | null;
  label: string | null;
}) {
  if (label === null) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${
        isFresh
          ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
          : "text-amber-400 bg-amber-500/10 border-amber-500/20"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${isFresh ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`}
      />
      {isFresh ? `Updated ${label}` : `Stale — ${label}`}
    </span>
  );
}

function AllocationBar({ allocation }: { allocation: AllocationAsset[] }) {
  const top5 = allocation.slice(0, 5);
  const othersPercent =
    100 - top5.reduce((sum, a) => sum + a.percentage, 0);

  return (
    <div className="mt-4">
      <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2 font-semibold">
        Asset Allocation
      </p>
      {/* Stacked bar */}
      <div className="flex w-full h-2.5 rounded-full overflow-hidden gap-px">
        {top5.map((a, i) => (
          <div
            key={a.assetCode + i}
            style={{
              width: `${a.percentage}%`,
              backgroundColor: assetColour(a.assetCode, i),
            }}
            title={`${a.assetCode}: ${a.percentage.toFixed(1)}%`}
          />
        ))}
        {othersPercent > 0.5 && (
          <div
            style={{ width: `${othersPercent}%`, backgroundColor: "#374151" }}
            title={`Others: ${othersPercent.toFixed(1)}%`}
          />
        )}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-2.5">
        {top5.map((a, i) => (
          <span key={a.assetCode + i} className="flex items-center gap-1 text-[11px] text-gray-400">
            <span
              className="w-2 h-2 rounded-sm flex-shrink-0"
              style={{ backgroundColor: assetColour(a.assetCode, i) }}
            />
            {a.assetCode} {a.percentage.toFixed(1)}%
          </span>
        ))}
        {othersPercent > 0.5 && (
          <span className="flex items-center gap-1 text-[11px] text-gray-400">
            <span className="w-2 h-2 rounded-sm flex-shrink-0 bg-gray-700" />
            Others {othersPercent.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-9 w-36 bg-white/10 rounded-lg" />
      <div className="h-5 w-24 bg-white/5 rounded" />
      <div className="h-2.5 w-full bg-white/10 rounded-full mt-5" />
      <div className="flex gap-3 mt-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-3 w-16 bg-white/5 rounded" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface PortfolioOverviewCardProps {
  publicKey: string | null;
  summary: PortfolioSummaryResponse | null;
  performance: PortfolioPerformanceResponse | null;
  allocation: AllocationAsset[] | null;
  isLoading: boolean;
  error: string | null;
  isFresh: boolean | null;
  lastUpdatedLabel: string | null;
  refresh: () => void;
}

export default function PortfolioOverviewCard({
  publicKey,
  summary,
  performance,
  allocation,
  isLoading,
  error,
  isFresh,
  lastUpdatedLabel,
  refresh,
}: PortfolioOverviewCardProps) {
  // ── State: no wallet ───────────────────────────────────────────────────
  if (!publicKey) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center h-full min-h-[180px]">
        <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center mb-3 border border-purple-500/20">
          <Wallet className="w-5 h-5 text-purple-400" />
        </div>
        <p className="text-sm text-gray-400 font-medium">Connect your wallet</p>
        <p className="text-xs text-gray-600 mt-1">Portfolio data will appear here</p>
      </div>
    );
  }

  // ── State: loading (first paint only — no stale data yet) ──────────────
  if (isLoading && !summary) {
    return <Skeleton />;
  }

  // ── State: error (no cached data available) ────────────────────────────
  if (error && !summary) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
        <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/20">
          <AlertCircle className="w-5 h-5 text-rose-400" />
        </div>
        <div>
          <p className="text-sm text-gray-300 font-medium">Could not load portfolio</p>
          <p className="text-xs text-gray-500 mt-0.5 max-w-[220px]">{error}</p>
        </div>
        <button
          id="portfolio-overview-retry-btn"
          onClick={refresh}
          className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── State: linked wallet not yet tracked in portfolio snapshots ────────
  if (summary && !summary.hasLinkedAccount) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
        <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
          <Wallet className="w-5 h-5 text-purple-400" />
        </div>
        <div>
          <p className="text-sm text-gray-300 font-medium">Link this wallet to your account</p>
          <p className="text-xs text-gray-500 mt-1 max-w-[220px] leading-relaxed">
            Portfolio totals appear after the connected wallet is linked for snapshot tracking.
          </p>
        </div>
      </div>
    );
  }

  // ── State: first-time user / no snapshot ───────────────────────────────
  if (!summary?.lastUpdated) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
        <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
          <Zap className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <p className="text-sm text-gray-300 font-medium">No snapshot yet</p>
          <p className="text-xs text-gray-500 mt-1 max-w-[220px] leading-relaxed">
            Your portfolio data will appear here after your first sync. This runs automatically every hour.
          </p>
        </div>
        <button
          id="portfolio-overview-refresh-btn"
          onClick={refresh}
          disabled={isLoading}
          className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
          Check again
        </button>
      </div>
    );
  }

  // ── State: populated ───────────────────────────────────────────────────
  const totalUsd = parseFloat(summary.totalValueUsd);
  const window24h = performance?.windows.find((w) => w.window === "24h");
  const pnlPositive = (window24h?.absolutePnl ?? 0) >= 0;
  const isEmptyPortfolio = totalUsd <= 0 && (!allocation || allocation.length === 0);

  return (
    <div className="space-y-1">
      {/* Total value */}
      <p className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">
        Total Value
      </p>
      <p className="text-3xl font-bold text-white tracking-tight">
        {formatUsd(totalUsd)}
      </p>

      {/* 24 h change chip */}
      {window24h?.hasData && window24h.absolutePnl !== null && (
        <div className="flex items-center gap-2 mt-1">
          <span
            className={`inline-flex items-center gap-1 text-sm font-semibold ${
              pnlPositive ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {pnlPositive ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            {pnlPositive ? "+" : ""}
            {formatUsd(window24h.absolutePnl)}
          </span>
          {window24h.percentageChange !== null && (
            <span
              className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                pnlPositive
                  ? "text-emerald-400 bg-emerald-500/10"
                  : "text-rose-400 bg-rose-500/10"
              }`}
            >
              {pnlPositive ? "+" : ""}
              {window24h.percentageChange.toFixed(2)}%
            </span>
          )}
          <span className="text-[10px] text-gray-600">24h</span>
        </div>
      )}

      {/* Allocation bar */}
      {allocation && allocation.length > 0 && (
        <AllocationBar allocation={allocation} />
      )}

      {isEmptyPortfolio && (
        <p className="text-xs text-gray-500 mt-4">
          No funded assets yet. Values will update after your first deposit is captured in a snapshot.
        </p>
      )}

      {/* Footer: freshness + refresh */}
      <div className="flex items-center justify-between pt-3 mt-1 border-t border-white/5">
        <FreshnessBadge isFresh={isFresh} label={lastUpdatedLabel} />
        <button
          id="portfolio-overview-refresh-btn"
          onClick={refresh}
          disabled={isLoading}
          title="Refresh portfolio data"
          className="p-1 rounded-md text-gray-500 hover:text-gray-300 hover:bg-white/5 disabled:opacity-40 transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );
}
