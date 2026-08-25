/**
 * Latency budget thresholds for testnet dependency health checks.
 *
 * Each dependency has two thresholds:
 *   - degradedMs  – response time above this triggers a "degraded" signal
 *                   (HTTP 200, summary = degraded).
 *   - hardDownMs  – response time above this (or a connection failure) triggers
 *                   a "hard-down" signal (HTTP 503, summary = down).
 *
 * Values are sourced from environment variables so they can be tuned per
 * deployment without a code change. See `.env.example` for the full list.
 */

export interface LatencyBudgetThreshold {
  /** Latency (ms) above which the dependency is considered degraded */
  degradedMs: number;
  /** Latency (ms) above which the dependency is considered hard-down */
  hardDownMs: number;
}

export interface LatencyBudgetConfig {
  horizon: LatencyBudgetThreshold;
  sorobanRpc: LatencyBudgetThreshold;
}

const env = process.env;

const toMs = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const latencyBudgetConfig: LatencyBudgetConfig = {
  horizon: {
    degradedMs: toMs(
      env.HEALTH_HORIZON_LATENCY_DEGRADED_MS,
      1_000, // 1 s — warn if Horizon is slow
    ),
    hardDownMs: toMs(
      env.HEALTH_HORIZON_LATENCY_HARD_DOWN_MS,
      4_000, // 4 s — treat as hard-down
    ),
  },
  sorobanRpc: {
    degradedMs: toMs(
      env.HEALTH_SOROBAN_RPC_LATENCY_DEGRADED_MS,
      1_500, // 1.5 s — RPC is heavier than Horizon root
    ),
    hardDownMs: toMs(
      env.HEALTH_SOROBAN_RPC_LATENCY_HARD_DOWN_MS,
      5_000, // 5 s — treat as hard-down
    ),
  },
};
