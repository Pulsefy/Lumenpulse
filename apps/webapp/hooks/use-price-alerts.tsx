"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  CreatePriceAlertPayload,
  PriceAlertApiService,
  PriceAlertRule,
  UpdatePriceAlertPayload,
} from '@/lib/price-alert-service';

interface PriceAlertsState {
  rules: PriceAlertRule[];
  isLoading: boolean;
  isSyncing: boolean;
  /** Error from loading the list. */
  error: string | null;
  /** Error from the last create/update/delete; the list stays visible. */
  mutationError: string | null;
  clearMutationError: () => void;
  refresh: () => Promise<void>;
  getRule: (id: string) => Promise<PriceAlertRule>;
  createRule: (payload: CreatePriceAlertPayload) => Promise<PriceAlertRule>;
  updateRule: (id: string, payload: UpdatePriceAlertPayload) => Promise<PriceAlertRule>;
  removeRule: (id: string) => Promise<void>;
}

const notInProvider = async (): Promise<never> => {
  throw new Error('usePriceAlerts must be used inside <PriceAlertsProvider>');
};

const PriceAlertsContext = createContext<PriceAlertsState>({
  rules: [],
  isLoading: false,
  isSyncing: false,
  error: null,
  mutationError: null,
  clearMutationError: () => {},
  refresh: async () => {},
  getRule: notInProvider,
  createRule: notInProvider,
  updateRule: notInProvider,
  removeRule: notInProvider,
});

export function usePriceAlerts() {
  return useContext(PriceAlertsContext);
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

interface PriceAlertsProviderProps {
  children: React.ReactNode;
  /** Skip fetching until the user is known to be authenticated. */
  enabled?: boolean;
}

export function PriceAlertsProvider({ children, enabled = true }: PriceAlertsProviderProps) {
  const [rules, setRulesState] = useState<PriceAlertRule[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Mirror of `rules` so mutations can read the pre-change value of a single
  // rule for rollback without closing over a stale list snapshot.
  const rulesRef = useRef<PriceAlertRule[]>(rules);
  const setRules = useCallback((updater: (prev: PriceAlertRule[]) => PriceAlertRule[]) => {
    setRulesState((prev) => {
      const next = updater(prev);
      rulesRef.current = next;
      return next;
    });
  }, []);

  const track = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setPending((n) => n + 1);
    try {
      return await work();
    } finally {
      setPending((n) => n - 1);
    }
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await PriceAlertApiService.list();
      setRules(() => data);
    } catch (err) {
      setError(messageOf(err, 'Failed to load price alerts'));
    } finally {
      setIsLoading(false);
    }
  }, [setRules]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const getRule = useCallback(
    async (id: string) => {
      const fresh = await PriceAlertApiService.get(id);
      setRules((prev) => prev.map((r) => (r.id === id ? fresh : r)));
      return fresh;
    },
    [setRules],
  );

  const createRule = useCallback(
    (payload: CreatePriceAlertPayload) =>
      track(async () => {
        setMutationError(null);
        const now = new Date().toISOString();
        const optimisticId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const optimistic: PriceAlertRule = {
          id: optimisticId,
          userId: '',
          symbol: payload.symbol.toUpperCase(),
          targetPrice: payload.targetPrice,
          condition: payload.condition,
          isActive: true,
          cooldownMinutes: payload.cooldownMinutes ?? 60,
          lastTriggeredAt: null,
          createdAt: now,
          updatedAt: now,
        };
        setRules((prev) => [optimistic, ...prev]);

        try {
          const created = await PriceAlertApiService.create(payload);
          setRules((prev) => prev.map((r) => (r.id === optimisticId ? created : r)));
          return created;
        } catch (err) {
          setRules((prev) => prev.filter((r) => r.id !== optimisticId));
          setMutationError(messageOf(err, 'Failed to create price alert'));
          throw err;
        }
      }),
    [setRules, track],
  );

  const updateRule = useCallback(
    (id: string, payload: UpdatePriceAlertPayload) =>
      track(async () => {
        setMutationError(null);
        const previous = rulesRef.current.find((r) => r.id === id);
        if (!previous) throw new Error(`Price alert ${id} is not loaded`);

        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...payload } : r)));

        try {
          const updated = await PriceAlertApiService.update(id, payload);
          setRules((prev) => prev.map((r) => (r.id === id ? updated : r)));
          return updated;
        } catch (err) {
          setRules((prev) => prev.map((r) => (r.id === id ? previous : r)));
          setMutationError(messageOf(err, 'Failed to update price alert'));
          throw err;
        }
      }),
    [setRules, track],
  );

  const removeRule = useCallback(
    (id: string) =>
      track(async () => {
        setMutationError(null);
        const index = rulesRef.current.findIndex((r) => r.id === id);
        if (index === -1) return;
        const removed = rulesRef.current[index];

        setRules((prev) => prev.filter((r) => r.id !== id));

        try {
          await PriceAlertApiService.remove(id);
        } catch (err) {
          // Put the rule back where it was.
          setRules((prev) => {
            if (prev.some((r) => r.id === id)) return prev;
            const next = [...prev];
            next.splice(Math.min(index, next.length), 0, removed);
            return next;
          });
          setMutationError(messageOf(err, 'Failed to delete price alert'));
          throw err;
        }
      }),
    [setRules, track],
  );

  const clearMutationError = useCallback(() => setMutationError(null), []);

  return (
    <PriceAlertsContext.Provider
      value={{
        rules,
        isLoading,
        isSyncing: pending > 0,
        error,
        mutationError,
        clearMutationError,
        refresh,
        getRule,
        createRule,
        updateRule,
        removeRule,
      }}
    >
      {children}
    </PriceAlertsContext.Provider>
  );
}
