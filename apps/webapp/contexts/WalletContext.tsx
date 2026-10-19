"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";

export type Chain = "XLM" | "USDC" | "EURC" | "AQUA";

export interface Wallet {
  id: string;
  label: string;
  address: string;
  chain: Chain;
  balance: string;
  balanceUSD: number;
  change24h: string;
  changePositive: boolean;
  assetCount: number;
}

export interface WalletContextType {
  wallets: Wallet[];
  activeWallet: Wallet | null;
  switchWallet: (id: string) => void;
  isLoading: boolean;
  error: string | null;
  retry: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWallets = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wallets");
      if (!res.ok) {
        throw new Error(`Failed to fetch wallets: ${res.status} ${res.statusText}`.trim());
      }
      const data = await res.json();
      const list: Wallet[] = Array.isArray(data)
        ? data
        : Array.isArray((data as { wallets?: unknown })?.wallets)
          ? ((data as { wallets: Wallet[] }).wallets)
          : (null as unknown as Wallet[]);

      if (!list) {
        throw new Error("Invalid response format: expected an array of wallets");
      }

      setWallets(list);

      // restore last active wallet from localStorage
      const saved =
        typeof window !== "undefined"
          ? localStorage.getItem("activeWalletId")
          : null;
      const valid = list.find((w) => w.id === saved);
      setActiveWalletId(valid ? valid.id : list[0]?.id ?? null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch wallets";
      console.error("Failed to fetch wallets", err);
      setError(message);
      setWallets([]);
      setActiveWalletId(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  function switchWallet(id: string) {
    setActiveWalletId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem("activeWalletId", id);
    }
  }

  const activeWallet = wallets.find((w) => w.id === activeWalletId) ?? null;

  return (
    <WalletContext.Provider
      value={{
        wallets,
        activeWallet,
        switchWallet,
        isLoading,
        error,
        retry: fetchWallets,
      }}
    >
      {error && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="wallet-error-banner"
          className="bg-red-500/10 border-b border-red-500/30 px-4 py-2 text-xs font-medium text-red-400 flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => void fetchWallets()}
            className="rounded bg-red-500/20 px-2 py-0.5 text-xs hover:bg-red-500/30 transition-colors shrink-0"
          >
            Retry
          </button>
        </div>
      )}
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}