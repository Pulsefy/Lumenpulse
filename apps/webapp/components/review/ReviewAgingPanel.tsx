"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Hourglass, RefreshCw } from "lucide-react";
import { canViewReviewMetrics, getCurrentUserRole, type UserRole } from "@/lib/auth-role";
import {
  DEFAULT_AGING_THRESHOLD_HOURS,
  ReviewMetricsApiService,
  combineBuckets,
  formatAge,
  isBucketOverdue,
  type AgingBucket,
  type ReviewMetricsResponse,
} from "@/lib/review-metrics-service";

const THRESHOLD_STORAGE_KEY = "lumenpulse_review_aging_threshold_hours";
const THRESHOLD_OPTIONS = [6, 24, 72, 168];

function readStoredThreshold(fallback: number): number {
  try {
    const parsed = Number(localStorage.getItem(THRESHOLD_STORAGE_KEY));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredThreshold(hours: number) {
  try {
    localStorage.setItem(THRESHOLD_STORAGE_KEY, String(hours));
  } catch {
    // Storage unavailable (private mode etc.) — the choice just won't persist.
  }
}

export function bucketQueueHref(bucket: AgingBucket): string {
  const params = new URLSearchParams({
    status: "IN_REVIEW",
    minAgeHours: String(bucket.minHours),
  });
  if (bucket.maxHours !== null) params.set("maxAgeHours", String(bucket.maxHours));
  return `/review?${params.toString()}`;
}

interface ReviewAgingPanelProps {
  /** Hours after which pending items are flagged. Overrides the env default. */
  thresholdHours?: number;
  /** Injected for tests; defaults to the role in the auth-token JWT. */
  role?: UserRole | null;
}

export function ReviewAgingPanel({ thresholdHours, role: roleProp }: ReviewAgingPanelProps) {
  const defaultThreshold = thresholdHours ?? DEFAULT_AGING_THRESHOLD_HOURS;
  const [role, setRole] = useState<UserRole | null | undefined>(roleProp);
  const [threshold, setThreshold] = useState(defaultThreshold);
  const [metrics, setMetrics] = useState<ReviewMetricsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (roleProp === undefined) setRole(getCurrentUserRole());
    else setRole(roleProp);
  }, [roleProp]);

  useEffect(() => {
    setThreshold(readStoredThreshold(defaultThreshold));
  }, [defaultThreshold]);

  const allowed = role !== undefined && canViewReviewMetrics(role);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setMetrics(await ReviewMetricsApiService.getAging());
    } catch (err) {
      setMetrics(null);
      setError(err instanceof Error ? err.message : "Failed to load aging metrics");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  if (!allowed) return null;

  const buckets = metrics ? combineBuckets(metrics.domains) : [];
  const total = metrics?.grandTotalOpen ?? 0;
  const oldestMs = metrics
    ? metrics.domains.reduce<number | null>(
        (max, d) => (d.oldestAgeMs !== null && (max === null || d.oldestAgeMs > max) ? d.oldestAgeMs : max),
        null,
      )
    : null;
  const overdueCount = buckets
    .filter((b) => isBucketOverdue(b, threshold))
    .reduce((sum, b) => sum + b.count, 0);
  const hasData = !!metrics && buckets.length > 0 && total > 0;

  const onThresholdChange = (hours: number) => {
    setThreshold(hours);
    writeStoredThreshold(hours);
  };

  const thresholdOptions = Array.from(new Set([...THRESHOLD_OPTIONS, defaultThreshold, threshold])).sort(
    (a, b) => a - b,
  );

  return (
    <section
      aria-labelledby="review-aging-heading"
      className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 space-y-4"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Hourglass className="w-4 h-4 text-primary" />
          <h2 id="review-aging-heading" className="text-sm font-semibold">
            Pending review aging
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="aging-threshold" className="text-xs text-foreground/40">
            Flag after
          </label>
          <select
            id="aging-threshold"
            value={threshold}
            onChange={(e) => onThresholdChange(Number(e.target.value))}
            className="rounded-md border border-white/10 bg-transparent px-2 py-1 text-xs"
          >
            {thresholdOptions.map((h) => (
              <option key={h} value={h}>
                {h < 24 || h % 24 !== 0 ? `${h}h` : `${h / 24}d`}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={load}
            aria-label="Refresh aging metrics"
            className="p-1.5 rounded-md border border-white/10 text-foreground/50 hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {isLoading && !metrics && (
        <div data-testid="aging-loading" className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && error && (
        <p className="text-xs text-foreground/40">
          Aging metrics are unavailable right now. The review queue below is unaffected.
        </p>
      )}

      {!isLoading && !error && !hasData && (
        <p className="text-xs text-foreground/40">No pending items are waiting for review.</p>
      )}

      {hasData && (
        <>
          <div className="flex items-center gap-4 text-xs text-foreground/50 flex-wrap">
            <span>
              <span className="font-semibold text-foreground/80">{total}</span> pending
            </span>
            <span>
              Oldest <span className="font-semibold text-foreground/80">{formatAge(oldestMs)}</span>
            </span>
            {overdueCount > 0 && (
              <span className="inline-flex items-center gap-1 text-red-400" role="status">
                <AlertTriangle className="w-3.5 h-3.5" />
                {overdueCount} past threshold
              </span>
            )}
          </div>

          <ul className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {buckets.map((bucket) => {
              const overdue = isBucketOverdue(bucket, threshold) && bucket.count > 0;
              return (
                <li key={bucket.label}>
                  <Link
                    href={bucketQueueHref(bucket)}
                    data-overdue={overdue ? "true" : undefined}
                    aria-label={`${bucket.count} pending ${bucket.label}${overdue ? ", past threshold" : ""}`}
                    className={`block rounded-lg border p-2.5 text-center transition-colors ${
                      overdue
                        ? "border-red-500/30 bg-red-500/10 hover:bg-red-500/15"
                        : "border-white/5 bg-white/[0.02] hover:bg-white/[0.05]"
                    }`}
                  >
                    <p className={`text-lg font-bold ${overdue ? "text-red-400" : "text-foreground/80"}`}>
                      {bucket.count}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-foreground/40 mt-0.5">
                      {bucket.label}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
