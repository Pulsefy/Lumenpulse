"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Chain = "ETH" | "SOL" | "BNB" | "MATIC";

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

interface WalletContextType {
  wallets: Wallet[];
  activeWallet: Wallet | null;
  switchWallet: (id: string) => void;
  isLoading: boolean;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchWallets() {
      try {
        const res = await fetch("/api/wallets");
        const data: Wallet[] = await res.json();
        setWallets(data);

        // restore last active wallet from localStorage
        const saved = localStorage.getItem("activeWalletId");
        const valid = data.find((w) => w.id === saved);
        setActiveWalletId(valid ? valid.id : data[0]?.id ?? null);
      } catch (err) {
        console.error("Failed to fetch wallets", err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchWallets();
  }, []);

  function switchWallet(id: string) {
    setActiveWalletId(id);
    localStorage.setItem("activeWalletId", id);
  }

  const activeWallet = wallets.find((w) => w.id === activeWalletId) ?? null;

  return (
    <WalletContext.Provider value={{ wallets, activeWallet, switchWallet, isLoading }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}