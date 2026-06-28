"use client";

import { useMemo } from "react";
import { useStellarConfig } from "@/contexts/StellarConfigContext";
import { useStellarWallet } from "@/app/providers";

/**
 * The set of actionable prerequisites checked before a contribution is
 * allowed to start building its transaction. Each reason maps to a single,
 * user-visible message that explains what to do next.
 *
 * - `wallet_disconnected`     — no publicKey on the wallet context
 * - `wallet_rejected`         — user previously declined the connection prompt
 * - `wallet_missing_extension`— Freighter extension is not installed
 * - `wallet_connecting`       — a connection attempt is in flight
 * - `config_loading`          — Stellar runtime config has not resolved yet
 * - `config_error`            — Stellar runtime config fetch failed
 * - `vault_contract_missing`  — runtime config lacks the crowdfund vault id
 * - `amount_invalid`          — caller-supplied amount failed local validation
 */
export type ReadinessReason =
  | "wallet_disconnected"
  | "wallet_rejected"
  | "wallet_missing_extension"
  | "wallet_connecting"
  | "config_loading"
  | "config_error"
  | "vault_contract_missing"
  | "amount_invalid";

export interface ReadinessIssue {
  /** Stable id used for analytics / testing. */
  reason: ReadinessReason;
  /** Short title (1-3 words) suitable for a badge / aria-label. */
  title: string;
  /** Longer, user-facing guidance describing the missing prerequisite and how to fix it. */
  guidance: string;
  /** When true, the UI should keep the action button visible but disabled. */
  blocking: boolean;
}

export interface ReadinessResult {
  /** True when no issues block the action. */
  ready: boolean;
  /** Issues sorted by severity (most actionable first). Empty when ready. */
  issues: ReadinessIssue[];
  /**
   * First blocking issue, or `null` if nothing blocks. Useful for early
   * bail-outs in submit handlers without iterating `issues`.
   */
  blocker: ReadinessIssue | null;
}

/**
 * Validate a contribution amount locally before any network round-trip.
 * Returns an issue when the amount is missing, non-numeric, or not positive.
 * Pass `null` to skip the amount check (e.g. while the user has not typed yet).
 */
export function validateAmount(amount: string | null): ReadinessIssue | null {
  if (amount === null || amount === undefined) return null;
  const trimmed = amount.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      reason: "amount_invalid",
      title: "Invalid amount",
      guidance: "Enter a positive amount in XLM (e.g. 10 or 0.5).",
      blocking: true,
    };
  }
  return null;
}

interface UseWalletReadinessOptions {
  /**
   * Optional contribution amount to validate. When provided (and non-null),
   * a non-positive or non-numeric value is added as a blocking issue.
   */
  amount?: string | null;
}

/**
 * Aggregate the wallet context and the Stellar runtime config context into
 * a single readiness verdict for the contribution signing flow.
 *
 * This is intentionally a pure derivation — no network calls, no async work,
 * and no React state. Components re-render only when the underlying
 * contexts update, so the check itself is cheap.
 */
export function useWalletReadiness(
  options: UseWalletReadinessOptions = {},
): ReadinessResult {
  const { publicKey, status: walletStatus } = useStellarWallet();
  const { config, status: configStatus } = useStellarConfig();
  const { amount } = options;

  return useMemo<ReadinessResult>(() => {
    const issues: ReadinessIssue[] = [];

    // ── Wallet readiness ─────────────────────────────────────────────────
    switch (walletStatus) {
      case "connecting":
        issues.push({
          reason: "wallet_connecting",
          title: "Connecting wallet",
          guidance:
            "Wallet connection is in progress. Wait a moment and try again.",
          blocking: true,
        });
        break;
      case "missing_extension":
        issues.push({
          reason: "wallet_missing_extension",
          title: "Freighter not installed",
          guidance:
            "Install the Freighter browser extension from freighter.app, then refresh this page.",
          blocking: true,
        });
        break;
      case "rejected":
        issues.push({
          reason: "wallet_rejected",
          title: "Connection declined",
          guidance:
            "You previously declined the wallet connection. Click Connect Wallet to try again.",
          blocking: true,
        });
        break;
      case "connected":
      case "previously_connected":
      case "disconnected":
        if (!publicKey) {
          issues.push({
            reason: "wallet_disconnected",
            title: "Wallet not connected",
            guidance:
              "Connect your Stellar wallet before contributing to a project.",
            blocking: true,
          });
        }
        break;
      default:
        // Unknown future status — fall back to the disconnected check.
        if (!publicKey) {
          issues.push({
            reason: "wallet_disconnected",
            title: "Wallet not connected",
            guidance:
              "Connect your Stellar wallet before contributing to a project.",
            blocking: true,
          });
        }
        break;
    }

    // ── Config readiness ─────────────────────────────────────────────────
    if (configStatus === "loading") {
      issues.push({
        reason: "config_loading",
        title: "Loading configuration",
        guidance:
          "Network configuration is still loading. This usually resolves in a few seconds.",
        blocking: true,
      });
    } else if (configStatus === "error" || !config) {
      issues.push({
        reason: "config_error",
        title: "Configuration unavailable",
        guidance:
          "Could not load the Stellar runtime configuration. Check your network connection and reload the page.",
        blocking: true,
      });
    } else if (!config.contracts?.crowdfundVault) {
      issues.push({
        reason: "vault_contract_missing",
        title: "Vault address missing",
        guidance:
          "The Crowdfund Vault contract address is not configured for this environment. Contact a maintainer.",
        blocking: true,
      });
    }

    // ── Amount validation (optional) ────────────────────────────────────
    const amountIssue = validateAmount(amount ?? null);
    if (amountIssue) issues.push(amountIssue);

    const blocker = issues.find((i) => i.blocking) ?? null;
    return { ready: blocker === null, issues, blocker };
  }, [publicKey, walletStatus, config, configStatus, amount]);
}
