"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

interface ConfigErrorBannerProps {
  /** The error message to display */
  error: string | null;
  /** Called when the user clicks "Try again" */
  onRetry?: () => void;
  /** Whether a retry is currently in progress */
  isRetrying?: boolean;
}

/**
 * Full-page error state shown when the Stellar config cannot be loaded on startup.
 * Provides a clear explanation and a retry action so users aren't left with a blank screen.
 */
export function ConfigErrorBanner({
  error,
  onRetry,
  isRetrying = false,
}: ConfigErrorBannerProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center"
    >
      <div className="max-w-md space-y-6">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="rounded-full bg-red-500/10 p-4">
            <AlertTriangle
              className="h-10 w-10 text-red-400"
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">
            Unable to load configuration
          </h1>
          <p className="text-sm text-muted-foreground">
            LumenPulse could not fetch the Stellar network configuration from
            the server. Some features may be unavailable until this is resolved.
          </p>
        </div>

        {/* Error detail */}
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-left">
            <p className="text-xs font-mono text-red-400 break-words">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          {onRetry && (
            <button
              onClick={onRetry}
              disabled={isRetrying}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {isRetrying ? "Retrying…" : "Try again"}
            </button>
          )}

          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/5"
          >
            Reload page
          </button>
        </div>

        {/* Help text */}
        <p className="text-xs text-muted-foreground">
          If this problem persists, please check that the backend service is
          running and reachable.
        </p>
      </div>
    </div>
  );
}

/**
 * Inline variant — use inside a panel or card rather than full-page.
 */
export function ConfigErrorInline({
  error,
  onRetry,
  isRetrying = false,
}: ConfigErrorBannerProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
        aria-hidden="true"
      />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium text-red-400">
          Stellar config unavailable
        </p>
        {error && (
          <p className="text-xs text-muted-foreground break-words">{error}</p>
        )}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={isRetrying}
          aria-label="Retry loading config"
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  );
}
