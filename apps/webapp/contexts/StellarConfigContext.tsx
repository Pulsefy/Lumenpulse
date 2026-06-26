"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import type { StellarConfig } from "@/types/stellar-config";

// ── Types ──────────────────────────────────────────────────────────────────

type ConfigStatus = "loading" | "ready" | "error";

interface StellarConfigState {
  /** The fetched config, or null while loading / on error */
  config: StellarConfig | null;
  status: ConfigStatus;
  /** Human-readable error message when status === 'error' */
  error: string | null;
  /** Re-fetch the config (e.g. after a transient network failure) */
  retry: () => void;
}

// ── Context ────────────────────────────────────────────────────────────────

const StellarConfigContext = createContext<StellarConfigState>({
  config: null,
  status: "loading",
  error: null,
  retry: () => {},
});

// ── Provider ───────────────────────────────────────────────────────────────

const CONFIG_URL = "/api/config/stellar";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;

const SUPPORTED_NETWORKS: ReadonlySet<string> = new Set(["testnet", "mainnet"]);

function validateStellarConfig(data: unknown): StellarConfig {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      "Invalid configuration: the server returned an unexpected response format."
    );
  }

  const d = data as Record<string, unknown>;

  if (typeof d.network !== "string" || !SUPPORTED_NETWORKS.has(d.network)) {
    throw new Error(
      `Unsupported environment "${String(d.network ?? "unknown")}". ` +
        'Expected "testnet" or "mainnet". ' +
        "Check BACKEND_API_URL and server environment variables."
    );
  }

  if (
    !d.contracts ||
    typeof d.contracts !== "object" ||
    Array.isArray(d.contracts)
  ) {
    throw new Error(
      "Contract configuration is missing from the server response. " +
        "The backend may not have contract addresses configured for this environment."
    );
  }

  return data as StellarConfig;
}

async function fetchStellarConfig(signal: AbortSignal): Promise<StellarConfig> {
  let lastError: Error = new Error("Unknown error");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(CONFIG_URL, {
        signal,
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(
          `Config endpoint returned ${response.status}. ` +
            "Check that the backend is running and BACKEND_API_URL is set correctly."
        );
      }

      const data: StellarConfig = validateStellarConfig(await response.json());
      return data;
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        throw err; // Don't retry on abort
      }

      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_MS * attempt)
        );
      }
    }
  }

  throw lastError;
}

export function StellarConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<StellarConfig | null>(null);
  const [status, setStatus] = useState<ConfigStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    setStatus("loading");
    setError(null);

    fetchStellarConfig(controller.signal)
      .then((data) => {
        setConfig(data);
        setStatus("ready");
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        const message =
          err instanceof Error ? err.message : "Failed to load Stellar config";
        console.error("[StellarConfigProvider]", message);
        setError(message);
        setStatus("error");
      });

    return () => controller.abort();
  }, [retryCount]);

  const retry = () => setRetryCount((n) => n + 1);

  return (
    <StellarConfigContext.Provider value={{ config, status, error, retry }}>
      {children}
    </StellarConfigContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Access the Stellar runtime config fetched from the backend on startup.
 *
 * @example
 * const { config, status, error, retry } = useStellarConfig();
 * if (status === 'loading') return <Spinner />;
 * if (status === 'error') return <ConfigErrorBanner error={error} onRetry={retry} />;
 * // config is guaranteed non-null here
 */
export function useStellarConfig(): StellarConfigState {
  return useContext(StellarConfigContext);
}
