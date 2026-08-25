import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from './AuthContext';
import {
  WatchlistItem,
  WatchlistItemType,
  AddToWatchlistPayload,
  ConflictInfo,
  RollbackInfo,
  getLocalWatchlist,
  setLocalWatchlist,
  clearWatchlistData,
  toggleWatchlistItem as toggleItem,
  syncAndGetWatchlist,
  getLastSyncedAt,
} from '../lib/watchlist';
import { storage } from '../lib/storage';

interface SyncState {
  pendingCount: number;
  lastSyncedAt: string | null;
  conflictSymbols: string[];
  rollbackSymbols: string[];
}

interface WatchlistContextType {
  items: WatchlistItem[];
  isLoading: boolean;
  error: string | null;
  syncState: SyncState;
  refresh: () => Promise<void>;
  toggleItem: (payload: AddToWatchlistPayload) => Promise<{ added: boolean; error?: string }>;
  isInWatchlist: (symbol: string, type?: WatchlistItemType) => boolean;
  clearWatchlist: () => Promise<void>;
}

const WatchlistContext = createContext<WatchlistContextType | null>(null);

const SYNC_INTERVAL = 30000;

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({
    pendingCount: 0,
    lastSyncedAt: null,
    conflictSymbols: [],
    rollbackSymbols: [],
  });
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevUserIdRef = useRef<string | undefined>(undefined);

  const loadUserId = useCallback(async () => {
    try {
      const meta = await storage.getWalletMetadata();
      const id = meta.activePublicKey || undefined;
      setUserId(id);
      return id;
    } catch {
      setUserId(undefined);
      return undefined;
    }
  }, []);

  const loadWatchlist = useCallback(async () => {
    try {
      setError(null);
      const uid = userId;
      const result = await syncAndGetWatchlist(uid);
      setItems(result.items);

      const lastSynced = await getLastSyncedAt(uid);
      setSyncState((prev) => ({
        ...prev,
        pendingCount: 0,
        lastSyncedAt: lastSynced || new Date().toISOString(),
        conflictSymbols: result.conflicts.map((c) => c.symbol),
        rollbackSymbols: result.rollbacks.map((r) => r.symbol),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load watchlist';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const uid = await loadUserId();
    if (uid !== userId) {
      setUserId(uid);
    }
    await loadWatchlist();
  }, [loadUserId, loadWatchlist, userId]);

  const toggleItemHandler = useCallback(
    async (payload: AddToWatchlistPayload) => {
      const uid = userId;
      const result = await toggleItem(payload, uid);

      if (result.conflict) {
        setSyncState((prev) => ({
          ...prev,
          conflictSymbols: [...new Set([...prev.conflictSymbols, payload.symbol])],
        }));
      } else {
        setSyncState((prev) => ({
          ...prev,
          conflictSymbols: prev.conflictSymbols.filter((s) => s !== payload.symbol),
        }));
      }

      await loadWatchlist();
      return { added: result.added, error: result.error };
    },
    [userId, loadWatchlist],
  );

  const isInWatchlist = useCallback(
    (symbol: string, type?: WatchlistItemType) => {
      return items.some((i) => i.symbol === symbol && (!type || i.type === type));
    },
    [items],
  );

  const clearWatchlist = useCallback(async () => {
    await clearWatchlistData(userId);
    setItems([]);
    setSyncState({ pendingCount: 0, lastSyncedAt: null, conflictSymbols: [], rollbackSymbols: [] });
  }, [userId]);

  const checkPendingOps = useCallback(async () => {
    const { getPendingOperationsCount } = await import('../lib/watchlist');
    const count = await getPendingOperationsCount(userId);
    setSyncState((prev) => ({ ...prev, pendingCount: count }));
  }, [userId]);

  useEffect(() => {
    if (isAuthenticated) {
      refresh();
    } else {
      setItems([]);
      setError(null);
      setIsLoading(false);
      setSyncState({ pendingCount: 0, lastSyncedAt: null, conflictSymbols: [], rollbackSymbols: [] });
    }
  }, [isAuthenticated, refresh]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && isAuthenticated) {
        loadWatchlist();
      }
    });
    return () => unsubscribe();
  }, [isAuthenticated, loadWatchlist]);

  useEffect(() => {
    if (isAuthenticated && userId) {
      syncTimerRef.current = setInterval(() => {
        loadWatchlist();
        checkPendingOps();
      }, SYNC_INTERVAL);
    }
    return () => {
      if (syncTimerRef.current) {
        clearInterval(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [isAuthenticated, userId, loadWatchlist, checkPendingOps]);

  const value = useMemo(
    () => ({
      items,
      isLoading,
      error,
      syncState,
      refresh,
      toggleItem: toggleItemHandler,
      isInWatchlist,
      clearWatchlist,
    }),
    [items, isLoading, error, syncState, refresh, toggleItemHandler, isInWatchlist, clearWatchlist],
  );

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist(): WatchlistContextType {
  const context = useContext(WatchlistContext);
  if (!context) {
    throw new Error('useWatchlist must be used within a WatchlistProvider');
  }
  return context;
}
