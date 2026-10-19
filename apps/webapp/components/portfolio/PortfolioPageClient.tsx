"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, AlertTriangle, Loader2, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { useStellarWallet } from "@/app/providers";
import PortfolioOverviewCard from "@/components/portfolio-overview-card";
import { usePortfolioSnapshot } from "@/hooks/usePortfolioSnapshot";
import {
  PortfolioApiService,
  type PortfolioAnomaly,
  type PortfolioAnomalyStatus,
} from "@/lib/api-services";
import {
  getCurrentUserId,
  getCurrentUserRole,
  REVIEW_ROLES,
  type UserRole,
} from "@/lib/auth-role";

const REVIEW_STATUS_LABELS: Record<PortfolioAnomalyStatus, string> = {
  unresolved: "Needs review",
  acknowledged: "Acknowledged",
};

const SEVERITY_STYLES: Record<string, string> = {
  low: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  medium: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  high: "border-rose-500/20 bg-rose-500/10 text-rose-300",
};

function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "No data";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function anomalyReason(anomaly: PortfolioAnomaly): string {
  if (anomaly.description?.trim()) return anomaly.description;
  return anomaly.anomalyType.replace(/[_-]+/g, " ");
}

export default function PortfolioPageClient() {
  const { publicKey } = useStellarWallet();
  const portfolio = usePortfolioSnapshot(publicKey);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [reviewRole, setReviewRole] = useState<UserRole | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [reviewAccessResolved, setReviewAccessResolved] = useState(false);
  const [anomalies, setAnomalies] = useState<PortfolioAnomaly[]>([]);
  const [anomaliesLoading, setAnomaliesLoading] = useState(true);
  const [anomaliesError, setAnomaliesError] = useState<string | null>(null);
  const [retryAnomalies, setRetryAnomalies] = useState(0);
  const [pendingReviews, setPendingReviews] = useState<Set<string>>(() => new Set());
  const [reviewErrors, setReviewErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setIsAuthenticated(PortfolioApiService.isAuthenticated());
    setReviewRole(getCurrentUserRole());
    setUserId(getCurrentUserId());
    setReviewAccessResolved(true);
  }, []);

  useEffect(() => {
    if (!reviewAccessResolved) return;

    if (!reviewRole || !REVIEW_ROLES.includes(reviewRole)) {
      setAnomalies([]);
      setAnomaliesLoading(false);
      setAnomaliesError(null);
      return;
    }

    if (!userId) {
      setAnomalies([]);
      setAnomaliesLoading(false);
      setAnomaliesError("Could not identify the signed-in reviewer. Sign in again and retry.");
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setAnomaliesLoading(true);
    setAnomaliesError(null);

    PortfolioApiService.getAnomalies(userId, controller.signal)
      .then(({ anomalies: results }) => {
        if (!cancelled) setAnomalies(results);
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        setAnomaliesError(
          error instanceof Error ? error.message : "Could not load portfolio anomalies.",
        );
      })
      .finally(() => {
        if (!cancelled) setAnomaliesLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reviewAccessResolved, reviewRole, userId, retryAnomalies]);

  const retryPortfolio = portfolio.refresh;

  const reviewAnomaly = async (anomaly: PortfolioAnomaly) => {
    const status: PortfolioAnomalyStatus =
      anomaly.status === "unresolved" ? "acknowledged" : "unresolved";
    setPendingReviews((current) => new Set(current).add(anomaly.id));
    setReviewErrors((current) => {
      const next = { ...current };
      delete next[anomaly.id];
      return next;
    });

    try {
      const updated = await PortfolioApiService.reviewAnomaly(anomaly.id, status);
      setAnomalies((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      setReviewErrors((current) => ({
        ...current,
        [anomaly.id]:
          error instanceof Error ? error.message : "Could not save this anomaly review.",
      }));
    } finally {
      setPendingReviews((current) => {
        const next = new Set(current);
        next.delete(anomaly.id);
        return next;
      });
    }
  };

  const totalValue = portfolio.summary
    ? Number.parseFloat(portfolio.summary.totalValueUsd)
    : 0;
  const hasPortfolioData = Boolean(
    portfolio.summary?.hasLinkedAccount &&
      portfolio.summary.lastUpdated &&
      (totalValue > 0 || portfolio.summary.assets.length > 0),
  );
  const isEmptyPortfolio = Boolean(
    portfolio.summary &&
      !hasPortfolioData &&
      !portfolio.isLoading &&
      !portfolio.summaryError,
  );

  return (
    <main className="min-h-screen bg-background px-4 pb-16 pt-28 text-foreground sm:px-6">
      <div className="container mx-auto max-w-6xl">
        <header className="mb-8">
          <p className="mb-2 text-sm font-medium uppercase tracking-[0.2em] text-primary">
            Your assets
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Portfolio</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground/60 sm:text-base">
            Review your latest portfolio value, asset allocation, performance, and any
            portfolio anomalies.
          </p>
        </header>

        {!publicKey ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <Wallet className="mx-auto mb-3 h-8 w-8 text-primary" aria-hidden="true" />
            <h2 className="text-lg font-semibold">Connect your Stellar wallet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-foreground/60">
              Connect the wallet linked to your account to see its latest portfolio
              snapshot and performance.
            </p>
          </section>
        ) : isAuthenticated === null ? (
          <section
            className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-sm text-foreground/50"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking your account…
          </section>
        ) : !isAuthenticated ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <h2 className="text-lg font-semibold">Sign in to view your portfolio</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-foreground/60">
              Your portfolio snapshots are available after you sign in and link this wallet.
            </p>
            <Link
              href="/auth/login?callbackUrl=%2Fportfolio"
              className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-primary/80"
            >
              Sign in
            </Link>
          </section>
        ) : (
          <>
            {portfolio.summaryError && !portfolio.summary ? (
              <section
                className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6"
                role="alert"
              >
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" aria-hidden="true" />
                  <div>
                    <h2 className="font-semibold">Could not load your portfolio</h2>
                    <p className="mt-1 text-sm text-foreground/60">{portfolio.summaryError}</p>
                    <button
                      type="button"
                      onClick={retryPortfolio}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5"
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      Try again
                    </button>
                  </div>
                </div>
              </section>
            ) : isEmptyPortfolio ? (
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
                <Wallet className="mb-3 h-7 w-7 text-primary" aria-hidden="true" />
                <h2 className="text-xl font-semibold">
                  {portfolio.summary?.hasLinkedAccount
                    ? "Your portfolio is ready to track"
                    : "No portfolio data yet"}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground/60">
                  {portfolio.summary?.hasLinkedAccount
                    ? "There are no funded assets in the latest snapshot yet. Once your linked wallet has assets and its first snapshot is recorded, your value, allocation, and performance will appear here."
                    : "Link your connected Stellar wallet to your account and wait for its first portfolio snapshot. Your asset values and performance will appear here when data is available."}
                </p>
                <button
                  type="button"
                  onClick={retryPortfolio}
                  disabled={portfolio.isLoading}
                  className="mt-5 inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm transition-colors hover:bg-white/5 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${portfolio.isLoading ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  Check for updates
                </button>
              </section>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[1.05fr_1.5fr]">
                <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
                  <div className="relative">
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold">Portfolio summary</h2>
                        <p className="mt-1 text-xs text-foreground/50">
                          Wallet {publicKey.slice(0, 6)}…{publicKey.slice(-5)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={retryPortfolio}
                        disabled={portfolio.isLoading}
                        aria-label="Refresh portfolio data"
                        className="rounded-lg p-2 text-foreground/50 transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${portfolio.isLoading ? "animate-spin" : ""}`}
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                    <PortfolioOverviewCard
                      publicKey={publicKey}
                      summary={portfolio.summary}
                      performance={portfolio.performance}
                      allocation={portfolio.allocation}
                      isLoading={portfolio.isLoading}
                      error={portfolio.summaryError}
                      isFresh={portfolio.isFresh}
                      lastUpdatedLabel={portfolio.lastUpdatedLabel}
                      refresh={retryPortfolio}
                    />
                    {portfolio.allocationError && (
                      <p className="mt-3 text-xs text-amber-300" role="status">
                        Asset allocation could not be loaded: {portfolio.allocationError}
                      </p>
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <h2 className="text-lg font-semibold">Performance</h2>
                  <p className="mt-1 text-sm text-foreground/50">
                    Portfolio change compared with earlier snapshots.
                  </p>
                  {portfolio.performanceError ? (
                    <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
                      <p className="text-amber-200">Performance data could not be loaded.</p>
                      <p className="mt-1 text-foreground/60">{portfolio.performanceError}</p>
                      <button
                        type="button"
                        onClick={retryPortfolio}
                        className="mt-3 text-primary underline underline-offset-4"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      {(portfolio.performance?.windows ?? []).map((window) => {
                        const change = window.absolutePnl;
                        const positive = change !== null && change >= 0;
                        return (
                          <article
                            key={window.window}
                            className="rounded-xl border border-white/10 bg-black/20 p-4"
                          >
                            <h3 className="text-sm font-medium text-foreground/60">
                              {window.window} change
                            </h3>
                            {window.hasData && change !== null ? (
                              <>
                                <p
                                  className={`mt-2 text-xl font-semibold ${
                                    positive ? "text-emerald-300" : "text-rose-300"
                                  }`}
                                >
                                  {positive ? "+" : ""}
                                  {formatUsd(change)}
                                </p>
                                {window.percentageChange !== null && (
                                  <p className="mt-1 text-xs text-foreground/50">
                                    {window.percentageChange > 0 ? "+" : ""}
                                    {window.percentageChange.toFixed(2)}%
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="mt-2 text-sm text-foreground/40">Not enough snapshot history</p>
                            )}
                          </article>
                        );
                      })}
                      {!portfolio.performance?.windows.length && (
                        <p className="text-sm text-foreground/50 sm:col-span-3">
                          Performance history will be available after more portfolio snapshots are recorded.
                        </p>
                      )}
                    </div>
                  )}
                </section>
              </div>
            )}

            <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="mb-5 flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
                <div>
                  <h2 className="text-lg font-semibold">Portfolio anomalies</h2>
                  <p className="mt-1 text-sm text-foreground/50">
                    Flagged portfolio activity and its recorded reason.
                  </p>
                </div>
              </div>

              {!reviewAccessResolved ? (
                <p className="flex items-center gap-2 text-sm text-foreground/50" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Checking anomaly review access…
                </p>
              ) : !reviewRole || !REVIEW_ROLES.includes(reviewRole) ? (
                <p className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-foreground/60">
                  Anomaly records and review actions are available to portfolio reviewers and
                  administrators. Your portfolio remains visible above.
                </p>
              ) : anomaliesLoading ? (
                <p className="flex items-center gap-2 text-sm text-foreground/50" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading flagged anomalies…
                </p>
              ) : anomaliesError ? (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4" role="alert">
                  <p className="text-sm text-rose-200">{anomaliesError}</p>
                  <button
                    type="button"
                    onClick={() => setRetryAnomalies((count) => count + 1)}
                    className="mt-3 text-sm text-primary underline underline-offset-4"
                  >
                    Retry
                  </button>
                </div>
              ) : anomalies.length === 0 ? (
                <p className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-foreground/60">
                  No portfolio anomalies have been flagged for this account.
                </p>
              ) : (
                <ul className="space-y-3">
                  {anomalies.map((anomaly) => {
                    const isPending = pendingReviews.has(anomaly.id);
                    const isUnresolved = anomaly.status === "unresolved";
                    const status = isUnresolved ? "unresolved" : "acknowledged";
                    return (
                      <li
                        key={anomaly.id}
                        className="rounded-xl border border-white/10 bg-black/20 p-4 sm:p-5"
                      >
                        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold">{anomaly.title}</h3>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-xs capitalize ${
                                  SEVERITY_STYLES[anomaly.severity] ??
                                  "border-white/10 bg-white/5 text-foreground/60"
                                }`}
                              >
                                {anomaly.severity} severity
                              </span>
                              <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-foreground/60">
                                {REVIEW_STATUS_LABELS[status]}
                              </span>
                            </div>
                            <p className="mt-2 text-sm leading-relaxed text-foreground/60">
                              <span className="font-medium text-foreground/80">Reason: </span>
                              {anomalyReason(anomaly)}
                            </p>
                            <p className="mt-2 text-xs text-foreground/40">
                              Flagged {formatDate(anomaly.createdAt)}
                            </p>
                            {reviewErrors[anomaly.id] && (
                              <p className="mt-2 text-sm text-rose-300" role="alert">
                                {reviewErrors[anomaly.id]}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => reviewAnomaly(anomaly)}
                            disabled={isPending}
                            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-primary/30 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                            )}
                            {isPending
                              ? "Saving…"
                              : isUnresolved
                                ? "Acknowledge"
                                : "Reopen"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
