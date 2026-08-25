"use client";

import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import { useStellarConfig } from "@/contexts/StellarConfigContext";
import {
  DependencyStatus,
  useDependencyHealth,
  OverallHealthState,
} from "@/hooks/useDependencyHealth";

// ── Constants ──────────────────────────────────────────────────────────────

/** Map a network identifier from the Stellar config onto a UI label.
 *  We intentionally render the full "Stellar Testnet" / "Stellar Mainnet"
 *  phrasing (rather than just "testnet" / "mainnet") so the banner remains
 *  unambiguous, and we never introduce EVM-equivalent terminology.
 */
const NETWORK_LABELS = {
  testnet: "Stellar Testnet",
  mainnet: "Stellar Mainnet",
} as const;

const STATE_DOT: Record<
  DependencyStatus["state"] | "unavailable",
  { dotColor: string; ringColor: string; ariaLabel: string }
> = {
  ok: {
    dotColor: "bg-emerald-400",
    ringColor: "ring-emerald-400/30",
    ariaLabel: "operational",
  },
  degraded: {
    dotColor: "bg-amber-400",
    ringColor: "ring-amber-400/30",
    ariaLabel: "slow",
  },
  hard_down: {
    dotColor: "bg-rose-400",
    ringColor: "ring-rose-400/30",
    ariaLabel: "down",
  },
  unknown: {
    dotColor: "bg-white/30",
    ringColor: "ring-white/10",
    ariaLabel: "checking",
  },
  unavailable: {
    dotColor: "bg-white/20",
    ringColor: "ring-white/10",
    ariaLabel: "unavailable",
  },
};

// ── Types ──────────────────────────────────────────────────────────────────

interface DependencyStatusBannerProps {
  /** Optional className appended to the outer container. */
  className?: string;
  /**
   * Optional callback invoked when the user clicks the refresh button.
   * If omitted, the banner wires its own retry using the hook.
   */
  onRefresh?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatLatency(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function isOperational(overall: OverallHealthState): boolean {
  return overall === "ok";
}

// ── Sub-components ────────────────────────────────────────────────────────

interface StatusPillProps {
  label: string;
  state: DependencyStatus["state"];
  latencyMs?: number;
  message?: string;
  testId?: string;
}

function StatusPill({ label, state, latencyMs, message, testId }: StatusPillProps) {
  const tone = STATE_DOT[state];
  const latency = formatLatency(latencyMs);

  // Build the screen-reader text once, in order: name + state + latency + reason.
  const ariaTextParts = [label, tone.ariaLabel];
  if (latency) ariaTextParts.push(latency);
  if (state === "hard_down" && message) ariaTextParts.push(message);
  const ariaText = ariaTextParts.join(", ");

  return (
    <span
      data-testid={testId}
      data-state={state}
      data-message={message ?? ""}
      title={
        state === "hard_down" && message
          ? message
          : latency
            ? `${label}: ${tone.ariaLabel} (${latency})`
            : `${label}: ${tone.ariaLabel}`
      }
      aria-label={ariaText}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/70"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-2 w-2 rounded-full ${tone.dotColor} ring-2 ${tone.ringColor}`}
      />
      <span className="text-foreground/80">{label}</span>
      <span className="text-foreground/55">·</span>
      <span className="capitalize text-foreground/65">
        {tone.ariaLabel}
      </span>
      {latency && (
        <>
          <span className="text-foreground/55">·</span>
          <span className="text-foreground/55 tabular-nums">{latency}</span>
        </>
      )}
    </span>
  );
}

interface NetworkPillProps {
  networkLabel: string;
}

function NetworkPill({ networkLabel }: NetworkPillProps) {
  // Testnet is rendered with an amber accent to match the existing top
  // banner convention; mainnet uses the muted/default surface so the
  // banner does not introduce alarming terminology. The label is always
  // suffixed with the full "Stellar ..." wording so the UI stays clear
  // about which ecosystem we are operating in.
  const isTestnetLabel = networkLabel.startsWith("Stellar Testnet");

  return (
    <span
      data-testid="network-pill"
      data-network={isTestnetLabel ? "testnet" : "mainnet"}
      aria-label={`Active network: ${networkLabel}`}
      className={
        isTestnetLabel
          ? "inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/[0.06] px-2.5 py-0.5 text-xs font-semibold text-amber-200/90"
          : "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-xs font-semibold text-foreground/80"
      }
    >
      <span
        aria-hidden="true"
        className={
          isTestnetLabel
            ? "h-1.5 w-1.5 rounded-full bg-amber-400"
            : "h-1.5 w-1.5 rounded-full bg-emerald-400"
        }
      />
      {networkLabel}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────

/**
 * Compact, non-intrusive banner that surfaces the active Stellar network
 * and the live status of Horizon + Soroban RPC on grants-related pages.
 *
 * Design notes:
 *  - We render inline (not sticky/fixed) so the banner stays out of the
 *    user's way. Existing app-level banners (e.g. the `testnet-banner` in
 *    providers.tsx) handle testnet warnings; this banner is the
 *    infrastructure analogue.
 *  - When the dependency endpoint is unreachable or the underlying
 *    Stellar config has not yet loaded, the banner degrades to a single
 *    muted row that does *not* draw attention to itself. No noisy
 *    spinners, no error icons in the visible UI.
 *  - All copy uses Stellar-specific terminology ("Horizon", "Soroban
 *    RPC") and surfaces the full network name "Stellar Testnet" /
 *    "Stellar Mainnet". We never echo EVM-specific terms.
 */
export function DependencyStatusBanner({
  className = "",
  onRefresh,
}: DependencyStatusBannerProps) {
  const { config, status: configStatus } = useStellarConfig();
  const {
    horizon,
    sorobanRpc,
    overallState,
    isLoading,
    isUnavailable,
    error,
    retry,
    lastFetchedAt,
  } = useDependencyHealth();

  // If the underlying Stellar config itself failed, the higher-level
  // ConfigErrorBanner is already being rendered at the app root. We do
  // not want to add a second, louder alert on top of it.
  if (configStatus === "error") {
    return null;
  }

  // While the config has not yet loaded we render an aria-hidden skeleton
  // so the layout does not jump when the real banner appears.
  if (configStatus === "loading" || !config) {
    return (
      <div
        data-testid="dependency-banner-loading"
        aria-hidden="true"
        className={`flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 ${className}`}
      >
        <span className="h-1.5 w-3 animate-pulse rounded-full bg-white/10" />
        <span className="h-3 w-32 animate-pulse rounded bg-white/5" />
        <span className="h-3 w-24 animate-pulse rounded bg-white/5" />
      </div>
    );
  }

  const networkLabel =
    NETWORK_LABELS[config.network] ?? `Stellar ${config.network}`;

  const handleRefresh = onRefresh ?? retry;
  // The backend guarantees the rollup state is consistent with the per-dep
  // state, but we double-check before showing the "all operational" affordance
  // so a malformed payload can never trick the UI into claiming everything is
  // fine while a dep is still unknown or down.
  const showHardDown =
    horizon.state === "hard_down" || sorobanRpc.state === "hard_down";
  const everyDepOk =
    horizon.state === "ok" && sorobanRpc.state === "ok";
  const hasFreshData = lastFetchedAt !== null && !isUnavailable;
  const allOperational =
    hasFreshData && isOperational(overallState) && everyDepOk;
  const refreshing = isLoading && hasFreshData;

  // Build the screen-reader announcement. We mirror the visible layout so
  // assistive tech reads the same information sighted users see.
  const ariaAnnouncement = isUnavailable
    ? "Active network and dependency status check unavailable."
    : showHardDown
      ? `Warning: ${networkLabel}; one or more Stellar dependencies are currently down.`
      : `${networkLabel}; Horizon and Soroban RPC statuses are visible below.`;

  return (
    <aside
      data-testid="dependency-status-banner"
      aria-live="polite"
      aria-label={ariaAnnouncement}
      className={`not-prose flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 text-sm ${className}`}
    >
      <NetworkPill networkLabel={networkLabel} />

      <span
        aria-hidden="true"
        className="hidden h-3 w-px bg-white/10 sm:inline-block"
      />

      {isUnavailable ? (
        <span
          data-testid="dependency-banner-unavailable"
          className="inline-flex items-center gap-1.5 text-xs text-foreground/45"
          title={error ?? "Dependency health endpoint unreachable"}
        >
          <WifiOff
            className="h-3.5 w-3.5"
            aria-hidden="true"
            aria-label="unavailable"
          />
          <span>Status check unavailable</span>
        </span>
      ) : (
        <>
          <StatusPill
            testId="horizon-pill"
            label="Horizon"
            state={horizon.state}
            latencyMs={horizon.latencyMs}
            message={horizon.message}
          />
          <StatusPill
            testId="soroban-pill"
            label="Soroban RPC"
            state={sorobanRpc.state}
            latencyMs={sorobanRpc.latencyMs}
            message={sorobanRpc.message}
          />
        </>
      )}

      <span className="ml-auto inline-flex items-center gap-2 text-xs text-foreground/45">
        {allOperational && !showHardDown && (
          <span
            data-testid="dependency-banner-all-ok"
            className="inline-flex items-center gap-1.5 text-emerald-300/70"
            aria-label="All Stellar dependencies operational"
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-emerald-400"
            />
            All dependencies OK
          </span>
        )}
        {!refreshing && (
          <button
            type="button"
            onClick={handleRefresh}
            aria-label="Refresh dependency status"
            data-testid="dependency-banner-refresh"
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] px-2 py-0.5 text-foreground/55 transition-colors hover:bg-white/[0.05] hover:text-foreground/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            <span>Refresh</span>
          </button>
        )}
        {refreshing && (
          <span
            aria-label="Refreshing dependency status"
            className="inline-flex items-center gap-1 text-foreground/45"
          >
            <Loader2
              className="h-3 w-3 animate-spin"
              aria-hidden="true"
            />
            <span>Refreshing</span>
          </span>
        )}
        {/* Last-fetched timestamp exposed as a data attribute for E2E and
            integration tests; intentionally aria-hidden so screen readers
            don't get timestamp noise with every refresh. */}
        {lastFetchedAt && (
          <span
            data-testid="dependency-banner-last-checked"
            data-last-fetched={lastFetchedAt}
            aria-hidden="true"
            className="hidden"
          >
            {new Date(lastFetchedAt).toISOString()}
          </span>
        )}
      </span>
    </aside>
  );
}

