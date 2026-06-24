"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useStellarWallet } from "@/app/providers";

interface WatchlistContextType {
  savedProjectIds: number[];
  toggleSavedProject: (projectId: number) => void;
  isProjectSaved: (projectId: number) => boolean;
}

const WatchlistContext = createContext<WatchlistContextType | undefined>(undefined);

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const { publicKey } = useStellarWallet();
  const [savedProjectIds, setSavedProjectIds] = useState<number[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Storage key is scoped to the wallet address if signed in, otherwise "anonymous"
  const storageKey = `lumenpulse_watchlist_${publicKey || "anonymous"}`;

  // Load from localStorage on mount or when publicKey changes
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        setSavedProjectIds(JSON.parse(stored));
      } else {
        setSavedProjectIds([]);
      }
    } catch (err) {
      console.warn("Failed to load watchlist from localStorage", err);
    }
    setIsLoaded(true);
  }, [storageKey]);

  // Save to localStorage whenever the array changes (after initial load)
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem(storageKey, JSON.stringify(savedProjectIds));
    }
  }, [savedProjectIds, isLoaded, storageKey]);

  const toggleSavedProject = (projectId: number) => {
    setSavedProjectIds((prev) => {
      if (prev.includes(projectId)) {
        return prev.filter((id) => id !== projectId);
      } else {
        return [...prev, projectId];
      }
    });
  };

  const isProjectSaved = (projectId: number) => savedProjectIds.includes(projectId);

  return (
    <WatchlistContext.Provider value={{ savedProjectIds, toggleSavedProject, isProjectSaved }}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  const context = useContext(WatchlistContext);
  if (context === undefined) {
    throw new Error("useWatchlist must be used within a WatchlistProvider");
  }
  return context;
}
