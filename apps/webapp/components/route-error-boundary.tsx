"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

interface RouteErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** The segment name for the error report context, e.g. "dashboard". */
  segment: string;
}

/**
 * Shared error boundary display used by every route-level `error.tsx`.
 * Shows a recoverable message with a retry action — never a stack trace.
 *
 * The `segment` prop is forwarded as structured context so an upstream
 * error-reporting hook (Issue 9) can tag the report with the failing route.
 * When the hook is not yet wired, the value is simply ignored.
 */
export function RouteErrorBoundary({
  error,
  reset,
  segment,
}: RouteErrorBoundaryProps) {
  // Forward to the global error-reporting seam when available.
  // This is the "clearly marked seam" referenced in the acceptance criteria.
  useEffect(() => {
    if (typeof window !== "undefined") {
      // @ts-expect-error — intentional seam for future error-reporting hook (Issue 9)
      window.__lumenpulse_reportError?.({
        message: error.message,
        digest: error.digest,
        segment,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
    }
  }, [error, segment]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex min-h-[60vh] flex-col items-center justify-center bg-background px-4 text-center"
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
            Something went wrong
          </h1>
          <p className="text-sm text-muted-foreground">
            An unexpected error occurred while loading this page. You can try
            again or return to the home page.
          </p>
        </div>

        {/* Error detail — only the message, never the full stack */}
        {error.message && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-left">
            <p className="text-xs font-mono text-red-400 break-words">
              {error.message}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>

          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/5"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Go home
          </Link>
        </div>

        {/* Help text */}
        <p className="text-xs text-muted-foreground">
          If this problem persists, please check your connection or try
          reloading the page.
        </p>
      </div>
    </div>
  );
}
