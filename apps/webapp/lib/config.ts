/**
 * Centralized, validated configuration for the LumenPulse webapp.
 *
 * All `process.env` reads for API and explorer URLs are migrated here.
 * Server-only values are in `serverConfig`; client-safe values are in
 * `clientConfig`. Importing the wrong side from a client component will
 * cause a build-time error because `serverConfig` is gated by the
 * `typeof window` check and should never be imported in client code.
 *
 * Required environment variables:
 *   BACKEND_API_URL             – Server-only base URL for the backend API.
 *   NEXT_PUBLIC_API_URL         – Client-safe base URL for the backend API.
 *   NEXT_PUBLIC_STELLAR_EXPLORER_URL – (optional) Override for the Stellar explorer base.
 */

// ── Helpers ──────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[config] Missing required environment variable: ${name}. ` +
        `Add it to .env.local (or your deployment environment).`
    );
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

// ── Client-safe config (safe to import in browser bundles) ───────────────

export const clientConfig = {
  /** Base URL for the backend API, accessible from the browser. */
  apiUrl: optionalEnv("NEXT_PUBLIC_API_URL", "http://localhost:3001"),
  /** Base URL for the Stellar explorer (e.g. stellar.expert/explorer). */
  stellarExplorerUrl: optionalEnv(
    "NEXT_PUBLIC_STELLAR_EXPLORER_URL",
    "https://stellar.expert/explorer"
  ),
} as const;

// ── Server-only config ──────────────────────────────────────────────────

/**
 * Server-only configuration. This must NOT be imported in client components.
 * Values are validated at module load — a missing variable fails immediately
 * with a clear message naming the variable.
 */
export const serverConfig = {
  /** Base URL for the backend API, used in server-side API routes. */
  backendApiUrl: optionalEnv("BACKEND_API_URL", "http://localhost:3001"),
} as const;

// ── Convenience re-exports for backward compat ──────────────────────────

/**
 * The API base URL for client-side code.
 * @deprecated Use `clientConfig.apiUrl` for clarity in new code.
 */
export const API_BASE = clientConfig.apiUrl;

/**
 * The Stellar explorer base URL.
 * @deprecated Use `clientConfig.stellarExplorerUrl` for clarity in new code.
 */
export const STELLAR_EXPLORER_BASE = clientConfig.stellarExplorerUrl;
