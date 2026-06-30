"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

/** Severity classification for a single dependency (Horizon, Soroban RPC). */
export type DependencyState = "ok" | "degraded" | "hard_down";

/** Aggregate state across all checked dependencies. */
export type OverallHealthState = DependencyState | "unavailable";

export interface DependencyStatus {
  state: DependencyState | "unknown";
  /** Measured round-trip latency in milliseconds, undefined when unreachable. */
  latencyMs?: number;
  /** Optional backend-supplied explanation of the current state. */
  message?: string;
}

export interface DependencyHealthReport {
  overallState: OverallHealthState;
  checkedAt: string | null;
  /** Status for the Stellar Horizon dependency. */
  horizon: DependencyStatus;
  /** Status for the Soroban JSON-RPC dependency. */
  sorobanRpc: DependencyStatus;
}

export interface UseDependencyHealthResult extends DependencyHealthReport {
  /** True while the first fetch is in flight. */
  isLoading: boolean;
  /** True when the endpoint is unreachable (network/DNS/CORS errors). */
  isUnavailable: boolean;
  /** Last error message (endpoint error, parse error, etc.). */
  error: string | null;
  /** Manually re-fetch the latest dependency health. */
  retry: () => void;
  /** Last time the data was refreshed (Date.now() or null before first fetch). */
  lastFetchedAt: number | null;
}

// ── Defaults ──────────────────────────────────────────────────────────────

const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;
// Only probe dependencies we already display in the UI; the backend may report
// more, but the banner is intentionally narrow in scope.
const KNOWN_DEPENDENCIES = ["horizon", "sorobanRpc"] as const;
type KnownDependency = (typeof KNOWN_DEPENDENCIES)[number];

// ── Helpers ───────────────────────────────────────────────────────────────

function parseBackendState(value: unknown): DependencyState | "unknown" {
  if (value === "ok" || value === "degraded" || value === "hard_down") {
    return value;
  }
  return "unknown";
}

function parseOverallState(value: unknown): OverallHealthState {
  // The rollup must be a member of OverallHealthState (no "unknown"). An
  // unrecognised payload collapses to "unavailable" so the UI can show a
  // muted "Status check unavailable" row instead of crashing on a malformed
  // contract.
  if (value === "ok" || value === "degraded" || value === "hard_down") {
    return value;
  }
  return "unavailable";
}

interface RawDependency {
  name?: string;
  latencyMs?: number | null;
  state?: string;
  message?: string;
}

interface RawLatencyReport {
  overallState?: string;
  checkedAt?: string;
  dependencies?: RawDependency[];
}

function pick(report: RawLatencyReport, name: KnownDependency): DependencyStatus {
  const match = (report.dependencies ?? []).find((dep) => dep?.name === name);
  if (!match) {
    return { state: "unknown" };
  }
  const state = parseBackendState(match.state);
  const status: DependencyStatus = { state };

  if (typeof match.latencyMs === "number" && Number.isFinite(match.latencyMs)) {
    status.latencyMs = match.latencyMs;
  }
  if (typeof match.message === "string" && match.message.length > 0) {
    // Backend messages can be technical; keep them concise for the UI but
    // expose the full string in the DOM via data-* for debugging.
    status.message = match.message;
  }
  return status;
}

function buildReport(raw: RawLatencyReport): DependencyHealthReport {
  const overallState = parseOverallState(raw.overallState);

  return {
    overallState,
    checkedAt: typeof raw.checkedAt === "string" ? raw.checkedAt : null,
    horizon: pick(raw, "horizon"),
    sorobanRpc: pick(raw, "sorobanRpc"),
  };
}

const EMPTY_REPORT: DependencyHealthReport = {
  overallState: "unavailable",
  checkedAt: null,
  horizon: { state: "unknown" },
  sorobanRpc: { state: "unknown" },
};

export interface UseDependencyHealthOptions {
  /** Override the API base URL (defaults to NEXT_PUBLIC_API_URL). */
  apiBase?: string;
  /** Override the poll interval in milliseconds (defaults to 30s). */
  pollIntervalMs?: number;
  /** Override the request timeout in milliseconds (defaults to 8s). */
  timeoutMs?: number;
  /** Override the fetch implementation, useful for tests. */
  fetchImpl?: typeof fetch;
  /**
   * When false, the hook fetches once and stops. When true (default), it
   * keeps polling until the component unmounts.
   */
  poll?: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────────

/**
 * Aggregate the backend `/health/latency` report into a UI-friendly shape
 * for grants (and other Stellar-touching) pages.
 *
 * The hook is intentionally tolerant:
 *  - It never throws into the React tree; failed fetches surface as
 *    `isUnavailable: true` and `overallState: "unavailable"`.
 *  - It polls in the background, but pauses while the document is hidden
 *    so we don't burn cycles on background tabs.
 *  - It exposes a `retry()` so banners can offer a manual refresh.
 *
 * The hook is also safe to render on the server: it skips the effect and
 * returns the empty report until hydration.
 */
export function useDependencyHealth(
  options: UseDependencyHealthOptions = {},
): UseDependencyHealthResult {
  const {
    apiBase = DEFAULT_API_BASE,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = REQUEST_TIMEOUT_MS,
    fetchImpl,
    poll = true,
  } = options;

  const [report, setReport] = useState<DependencyHealthReport>(EMPTY_REPORT);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isUnavailable, setIsUnavailable] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  // Use refs for values that the effect should see without re-subscribing.
  const apiBaseRef = useRef(apiBase);
  const fetchImplRef = useRef(fetchImpl);
  const pollIntervalRef = useRef(pollIntervalMs);
  const timeoutRef = useRef(timeoutMs);
  const pollRef = useRef(poll);

  apiBaseRef.current = apiBase;
  fetchImplRef.current = fetchImpl;
  pollIntervalRef.current = pollIntervalMs;
  timeoutRef.current = timeoutMs;
  pollRef.current = poll;

  const retry = useCallback(() => {
    setRetryCount((n) => n + 1);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      // SSR: leave the empty report; the server cannot probe the backend.
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let intervalHandle: ReturnType<typeof setInterval> | null = null;
    let visibilityListener: (() => void) | null = null;
    // Tracks the most recently issued fetch so a retry() can cancel an
    // in-flight request and avoid races where a stale response overwrites
    // fresher data.
    let activeController: AbortController | null = null;

    // Single-line helper because TS's flow analysis of let bindings across
    // closures is finicky when the variable gets narrowed to AbstractController
    // by assignments inside nested runFetch closures.
    const abortIfAny = (c: AbortController | null | undefined) => {
      if (c) c.abort();
    };

    const runFetch = async () => {
      const controller = new AbortController();
      activeController = controller;
      const requestTimeout = setTimeout(
        () => {
          controller.abort();
        },
        timeoutRef.current,
      );

      try {
        const fetcher = fetchImplRef.current ?? window.fetch.bind(window);
        const response = await fetcher(
          `${apiBaseRef.current}/health/latency`,
          {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );

        if (cancelled || activeController !== controller) return;

        // 5xx means at least one dependency is hard_down; treat as data, not
        // an error, so the UI can surface which dep is down.
        if (!response.ok && response.status < 500) {
          throw new Error(
            `Health endpoint returned ${response.status} ${response.statusText}.`,
          );
        }

        const raw = (await response.json()) as RawLatencyReport;
        if (cancelled || activeController !== controller) return;

        setReport(buildReport(raw));
        setError(null);
        setIsUnavailable(false);
        setLastFetchedAt(Date.now());
      } catch (err: unknown) {
        if (cancelled || activeController !== controller) return;
        if ((err as { name?: string })?.name === "AbortError") {
          // Component unmounted, timeout fired, or a retry cancelled us.
          return;
        }
        const message =
          err instanceof Error ? err.message : "Failed to fetch dependency health";
        // Only mark as unavailable when we *truly* couldn't reach the
        // endpoint — a 5xx response is data, not unavailability.
        setIsUnavailable(true);
        setError(message);
      } finally {
        clearTimeout(requestTimeout);
        if (!cancelled && activeController === controller) {
          setIsLoading(false);
        }
      }
    };

    const schedulePoll = () => {
      if (intervalHandle !== null) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
      if (!pollRef.current) return;
      intervalHandle = setInterval(() => {
        if (
          typeof document !== "undefined" &&
          document.visibilityState === "hidden"
        ) {
          return;
        }
        runFetch();
      }, pollIntervalRef.current);
    };

    // Bump retryCount → cancel any pending fetch and start fresh. This
    // keeps the hook cheap when the user spam-clicks Refresh.
    abortIfAny(activeController);
    setIsLoading(true);

    // Initial fetch — schedule immediately so the first paint after the
    // grants page mounts can already include banner data.
    runFetch().then(() => {
      if (cancelled) return;
      schedulePoll();
    });

    // Pause polling when the tab is hidden, refresh immediately when it
    // becomes visible again so users returning to the tab see fresh data.
    if (
      pollRef.current &&
      typeof document !== "undefined" &&
      typeof document.addEventListener === "function"
    ) {
      visibilityListener = () => {
        if (document.visibilityState === "visible") {
          runFetch();
        }
        schedulePoll();
      };
      document.addEventListener("visibilitychange", visibilityListener);
    }

    return () => {
      cancelled = true;
      if (intervalHandle !== null) clearInterval(intervalHandle);
      abortIfAny(activeController);
      if (
        visibilityListener &&
        typeof document !== "undefined" &&
        typeof document.removeEventListener === "function"
      ) {
        document.removeEventListener("visibilitychange", visibilityListener);
      }
    };
  }, [retryCount]);

  return {
    ...report,
    isLoading,
    isUnavailable,
    error,
    retry,
    lastFetchedAt,
  };
}

/** Display labels for the ThreeState classification (exposed for UI). */
export const DEPENDENCY_STATE_LABELS: Record<
  DependencyState | "unknown" | "unavailable",
  string
> = {
  ok: "operational",
  degraded: "slow",
  hard_down: "down",
  unknown: "checking",
  unavailable: "unavailable",
};
