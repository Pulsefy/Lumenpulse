"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StellarConfig {
  network: "testnet" | "mainnet";
  horizonUrl: string;
  sorobanRpcUrl: string;
  /** Null when the contract has not been deployed yet. */
  crowdfundContractId: string | null;
  explorerUrl: string;
}

type ConfigStatus = "loading" | "ready" | "error";

interface StellarConfigState {
  config: StellarConfig | null;
  status: ConfigStatus;
  /** Human-readable error message when status === "error". */
  error: string | null;
  /** Re-fetch the config (e.g. after a transient network failure). */
  retry: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const StellarConfigContext = createContext<StellarConfigState>({
  config: null,
  status: "loading",
  error: null,
  retry: () => {},
});

export function useStellarConfig(): StellarConfigState {
  return useContext(StellarConfigContext);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const CONFIG_ENDPOINT = `${API_BASE}/v1/config/stellar`;

const REQUEST_TIMEOUT_MS = 10_000;

async function fetchStellarConfig(): Promise<StellarConfig> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(CONFIG_ENDPOINT, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Config endpoint returned HTTP ${response.status}. ` +
          "Check that the backend is running and CROWDFUND_CONTRACT_ID is set."
      );
    }

    const data: StellarConfig = await response.json();
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function StellarConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<StellarConfig | null>(null);
  const [status, setStatus] = useState<ConfigStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setStatus("loading");
    setError(null);

    fetchStellarConfig()
      .then((data) => {
        if (cancelled) return;
        setConfig(data);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to load Stellar config.";
        console.error("[StellarConfigProvider]", message);
        setError(message);
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => setAttempt((n) => n + 1);

  return (
    <StellarConfigContext.Provider value={{ config, status, error, retry }}>
      {children}
    </StellarConfigContext.Provider>
  );
}
