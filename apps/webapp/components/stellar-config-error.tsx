"use client";

import { useStellarConfig } from "@/contexts/StellarConfigContext";

/**
 * Full-page error banner shown when the Stellar config endpoint is
 * unreachable or returns an error.  Rendered by the root Providers tree so
 * every page benefits from it automatically.
 */
export function StellarConfigError() {
  const { status, error, retry } = useStellarConfig();

  if (status !== "error") return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 top-0 z-50 flex items-start gap-4 bg-red-950/95 px-4 py-3 text-sm text-red-200 shadow-lg backdrop-blur-sm sm:items-center"
    >
      {/* Icon */}
      <svg
        aria-hidden="true"
        className="mt-0.5 h-5 w-5 shrink-0 text-red-400 sm:mt-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
        />
      </svg>

      {/* Message */}
      <div className="flex-1">
        <p className="font-semibold text-red-100">
          Stellar configuration unavailable
        </p>
        <p className="mt-0.5 text-red-300">
          {error ??
            "Could not load network configuration from the backend. Some features may not work correctly."}
        </p>
      </div>

      {/* Retry */}
      <button
        onClick={retry}
        className="shrink-0 rounded-md bg-red-800 px-3 py-1.5 text-xs font-medium text-red-100 transition hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        aria-label="Retry loading Stellar configuration"
      >
        Retry
      </button>
    </div>
  );
}
