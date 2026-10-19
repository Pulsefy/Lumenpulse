import { useState, useEffect } from "react";

export type DependencyStatus = "operational" | "degraded" | "unavailable" | "unknown";

export interface NetworkDependency {
  name: string;
  status: DependencyStatus;
  latencyMs?: number;
}

export interface TestnetStatusData {
  networkName: string;        // e.g. "Stellar Testnet"
  networkPassphrase: string;  // e.g. "Test SDF Network ; September 2015"
  dependencies: NetworkDependency[];
  fetchedAt: Date | null;
  isLoading: boolean;
  isUnavailable: boolean;
}

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
const SOROBAN_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";

async function checkEndpoint(name: string, url: string): Promise<NetworkDependency> {
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const latencyMs = Date.now() - start;
    return {
      name,
      status: res.ok ? "operational" : "degraded",
      latencyMs,
    };
  } catch {
    return { name, status: "unavailable" };
  }
}

export function useTestnetStatus(): TestnetStatusData {
  const [data, setData] = useState<TestnetStatusData>({
    networkName: "Stellar Testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    dependencies: [],
    fetchedAt: null,
    isLoading: true,
    isUnavailable: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchStatuses() {
      try {
        const [horizon, soroban] = await Promise.all([
          checkEndpoint("Horizon API", HORIZON_URL),
          checkEndpoint("Soroban RPC", SOROBAN_URL),
        ]);

        if (!cancelled) {
          setData({
            networkName: "Stellar Testnet",
            networkPassphrase: "Test SDF Network ; September 2015",
            dependencies: [horizon, soroban],
            fetchedAt: new Date(),
            isLoading: false,
            isUnavailable: false,
          });
        }
      } catch {
        if (!cancelled) {
          setData(prev => ({ ...prev, isLoading: false, isUnavailable: true }));
        }
      }
    }

    fetchStatuses();

    // Refresh every 60 seconds
    const interval = setInterval(fetchStatuses, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return data;
}