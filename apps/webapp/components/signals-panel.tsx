"use client";

import { RefreshCw, Activity, BarChart2, AlertTriangle, Info, ArrowRight } from "lucide-react";
import Link from "next/link";
import { ListSkeleton } from "@/components/ui/list-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ListError } from "@/components/ui/list-error";
import type { UserSignalsResponse, UserSignalDto, SignalCategory, SignalSeverity } from "@/lib/signals-service";

interface SignalAsset {
  code: string;
  issuer?: string;
}

interface SignalsPanelProps {
  data: UserSignalsResponse | null;
  isLoading: boolean;
  error: string | null;
  isFresh: boolean | null;
  ageLabel: string | null;
  refresh: () => void;
  isAuthenticated: boolean;
  assets?: SignalAsset[];
  onAssetSelect?: (asset: { code: string; issuer?: string; balance: string }) => void;
}

const categoryConfig: Record<SignalCategory, { label: string; color: string; icon: React.ReactNode }> = {
  holdings: { label: "Holdings", color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20", icon: <BarChart2 className="w-3.5 h-3.5" /> },
  activity: { label: "Activity", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: <Activity className="w-3.5 h-3.5" /> },
  risk: { label: "Risk", color: "text-amber-400 bg-amber-500/10 border-amber-500/20", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  fallback: { label: "Info", color: "text-gray-400 bg-gray-500/10 border-gray-500/20", icon: <Info className="w-3.5 h-3.5" /> },
};

const severityConfig: Record<SignalSeverity, { label: string; color: string; dot: string }> = {
  low: { label: "Low", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-400" },
  medium: { label: "Medium", color: "text-amber-400 bg-amber-500/10 border-amber-500/20", dot: "bg-amber-400" },
  high: { label: "High", color: "text-rose-400 bg-rose-500/10 border-rose-500/20", dot: "bg-rose-400" },
};

const severityBorder: Record<SignalSeverity, string> = {
  low: "border-l-emerald-500/40",
  medium: "border-l-amber-500/40",
  high: "border-l-rose-500/40",
};

function findReferencedAsset(signal: UserSignalDto, assets?: SignalAsset[]): SignalAsset | undefined {
  if (!assets || assets.length === 0) return undefined;
  const text = `${signal.title} ${signal.detail}`.toUpperCase();
  return assets.find((asset) => text.includes(asset.code.toUpperCase()));
}

function formatTimestamp(generatedAt: string | undefined): string {
  if (!generatedAt) return "";
  const date = new Date(generatedAt);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function SignalCard({ signal, generatedAt, assets, onAssetSelect }: {
  signal: UserSignalDto;
  generatedAt?: string;
  assets?: SignalAsset[];
  onAssetSelect?: (asset: { code: string; issuer?: string; balance: string }) => void;
}) {
  const cat = categoryConfig[signal.category] ?? categoryConfig.fallback;
  const sev = severityConfig[signal.severity] ?? severityConfig.low;
  const referencedAsset = findReferencedAsset(signal, assets);

  return (
    <div
      className={`border-l-4 ${severityBorder[signal.severity]} bg-white/[0.02] border border-white/5 rounded-lg p-4 hover:bg-white/[0.03] transition-colors`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border font-medium ${cat.color}`}>
            {cat.icon}
            {cat.label}
          </span>
          <h3 className="text-sm font-semibold text-white leading-tight">
            {signal.title}
          </h3>
          <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border font-medium ${sev.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
            Strength: {sev.label}
          </span>
        </div>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed mb-3">
        {signal.detail}
      </p>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-600">
          Generated: {formatTimestamp(generatedAt)}
        </span>
        {referencedAsset ? (
          <button
            onClick={() =>
              onAssetSelect?.({
                code: referencedAsset.code,
                issuer: referencedAsset.issuer,
                balance: "0",
              })
            }
            className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium hover:underline transition-colors"
          >
            View {referencedAsset.code}
            <ArrowRight className="w-3 h-3" />
          </button>
        ) : (
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium hover:underline transition-colors"
          >
            View portfolio
            <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>
    </div>
  );
}

function SignalsHeader({
  isFresh,
  ageLabel,
  isLoading,
  refresh,
}: {
  isFresh: boolean | null;
  ageLabel: string | null;
  isLoading: boolean;
  refresh: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-cyan-400" />
        <h2 className="text-xl font-semibold tracking-tight">Market Signals</h2>
      </div>
      <div className="flex items-center gap-2">
        {ageLabel && (
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
              isFresh
                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                : "text-amber-400 bg-amber-500/10 border-amber-500/20"
            }`}
          >
            {isFresh ? `Generated ${ageLabel}` : `Stale — ${ageLabel}`}
          </span>
        )}
        <button
          id="signals-refresh-btn"
          onClick={refresh}
          disabled={isLoading}
          title="Refresh signals"
          className="p-1 rounded-md text-gray-500 hover:text-gray-300 hover:bg-white/5 disabled:opacity-40 transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );
}

export default function SignalsPanel({
  data,
  isLoading,
  error,
  isFresh,
  ageLabel,
  refresh,
  isAuthenticated,
  assets,
  onAssetSelect,
}: SignalsPanelProps) {
  const header = (
    <SignalsHeader
      isFresh={isFresh}
      ageLabel={ageLabel}
      isLoading={isLoading}
      refresh={refresh}
    />
  );

  if (!isAuthenticated) {
    return (
      <>
        {header}
        <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
          <div className="w-10 h-10 rounded-full bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>
          <p className="text-sm text-gray-400">Sign in to view market signals</p>
          <p className="text-xs text-gray-600">Signals update every hour based on your portfolio</p>
        </div>
      </>
    );
  }

  if (isLoading && !data) {
    return (
      <>
        {header}
        <ListSkeleton count={5} variant="list" rowHeight={80} />
      </>
    );
  }

  if (error && !data) {
    return (
      <>
        {header}
        <ListError message={error} onRetry={refresh} />
      </>
    );
  }

  const signals = data?.signals ?? [];

  if (!data || signals.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={Activity}
          title="No signals available"
          description="No market signals have been generated for your account yet."
        />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="space-y-2">
        {signals.map((signal, index) => (
          <SignalCard
            key={`${signal.category}-${signal.title}-${index}`}
            signal={signal}
            generatedAt={data?.generatedAt}
            assets={assets}
            onAssetSelect={onAssetSelect}
          />
        ))}
      </div>
    </>
  );
}
