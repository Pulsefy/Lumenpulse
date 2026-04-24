"use client";

import React, { useState, useEffect, useCallback, createContext, useContext } from "react";
import {
  WatchlistApiService,
  WatchlistItem,
  WatchlistItemType,
  AddToWatchlistPayload,
  ToggleWatchlistResult,
} from "@/lib/watchlist-service";

interface WatchlistState {
  items: WatchlistItem[];
  total: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addItem: (payload: AddToWatchlistPayload) => Promise<WatchlistItem>;
  removeItem: (itemId: string) => Promise<void>;
  toggleItem: (payload: AddToWatchlistPayload) => Promise<ToggleWatchlistResult>;
  isInWatchlist: (symbol: string, type?: WatchlistItemType) => boolean;
}

const WatchlistContext = createContext<WatchlistState>({
  items: [],
  total: 0,
  isLoading: false,
  error: null,
  refresh: async () => {},
  addItem: async () => ({}) as WatchlistItem,
  removeItem: async () => {},
  toggleItem: async () => ({ added: false }),
  isInWatchlist: () => false,
});

export function useWatchlist() {
  return useContext(WatchlistContext);
}

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await WatchlistApiService.getWatchlist();
      setItems(response.items);
      setTotal(response.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load watchlist");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addItem = useCallback(
    async (payload: AddToWatchlistPayload): Promise<WatchlistItem> => {
      const item = await WatchlistApiService.addItem(payload);
      await refresh();
      return item;
    },
    [refresh],
  );

  const removeItem = useCallback(
    async (itemId: string): Promise<void> => {
      await WatchlistApiService.removeItem(itemId);
      await refresh();
    },
    [refresh],
  );

  const toggleItem = useCallback(
    async (payload: AddToWatchlistPayload): Promise<ToggleWatchlistResult> => {
      const result = await WatchlistApiService.toggleItem(payload);
      await refresh();
      return result;
    },
    [refresh],
  );

  const isInWatchlist = useCallback(
    (symbol: string, type?: WatchlistItemType): boolean => {
      return items.some(
        (item: WatchlistItem) =>
          item.symbol.toUpperCase() === symbol.toUpperCase() &&
          (!type || item.type === type),
      );
    },
    [items],
  );

  return (
    <WatchlistContext.Provider
      value={{
        items,
        total,
        isLoading,
        error,
        refresh,
        addItem,
        removeItem,
        toggleItem,
        isInWatchlist,
      }}
    >
      {children}
    </WatchlistContext.Provider>
  );
}
