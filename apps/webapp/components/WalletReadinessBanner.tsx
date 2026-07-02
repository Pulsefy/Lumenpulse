"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import type { ReadinessIssue } from "@/hooks/useWalletReadiness";

interface WalletReadinessBannerProps {
  issues: ReadinessIssue[];
  className?: string;
}

/**
 * Compact, single-message banner that surfaces the most actionable missing
 * prerequisite for the contribution signing flow.
 *
 * The banner renders nothing when `issues` is empty, so it is safe to drop
 * inline next to a contribution form. A connecting/config-loading state is
 * shown as a soft inline indicator rather than an error.
 */
export function WalletReadinessBanner({
  issues,
  className = "",
}: WalletReadinessBannerProps) {
  if (issues.length === 0) return null;

  const primary = issues[0];

  if (
    primary.reason === "wallet_connecting" ||
    primary.reason === "config_loading"
  ) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-xs text-foreground/60 ${className}`}
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin text-foreground/50" />
        <span>{primary.guidance}</span>
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] text-xs text-amber-200/90 leading-relaxed ${className}`}
    >
      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-400" />
      <div>
        <p className="font-semibold text-amber-200">{primary.title}</p>
        <p className="text-amber-200/70">{primary.guidance}</p>
      </div>
    </div>
  );
}
