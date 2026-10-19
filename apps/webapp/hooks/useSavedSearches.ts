"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SavedSearchesApiService,
  type SavedSearch,
  type CreateSavedSearchPayload,
  type UpdateSavedSearchPayload,
} from "@/lib/search-api";

/**
 * State and actions for the saved-searches feature.
 *
 * The hook mirrors the shape of `useWatchlist` so the dashboard can compose
 * both providers and consumers in a consistent way.  It exposes loading,
 * error, empty and pending-action states so the UI can render appropriate
 * shared components without duplicating logic.
 */
export interface UseSavedSearchesResult {
  /** All saved searches for the authenticated user, newest first. */
  items: SavedSearch[];
  /** Total count returned by the backend (same as items.length for now). */
  total: number;
  /** True while the initial fetch is in-flight. */
  isLoading: boolean;
  /** True while a mutation (create/rename/delete/toggle) is in-flight. */
  isMutating: boolean;
  /** Error message from the last operation, or null. */
  error: string | null;
  /** Re-fetch the list from the server. */
  refresh: () => Promise<void>;
  /** Create a new saved search and prepend it optimistically. */
  createSearch: (payload: CreateSavedSearchPayload) => Promise<SavedSearch>;
  /** Rename / update a saved search and patch the local state. */
  updateSearch: (id: string, payload: UpdateSavedSearchPayload) => Promise<SavedSearch>;
  /** Delete a saved search and remove it from the local state. */
  deleteSearch: (id: string) => Promise<void>;
  /** Toggle the notification subscription for a saved search. */
  toggleNotifications: (id: string, enabled: boolean) => Promise<void>;
}

/**
 * React hook providing saved-searches state and mutation helpers.
 *
 * The hook fetches once on mount (skipped when no auth cookie is present),
 * and exposes stable action callbacks that keep local state in sync with the
 * backend while surfacing errors to the caller.
 */
export function useSavedSearches(): UseSavedSearchesResult {
  const [items, setItems] = useState<SavedSearch[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await SavedSearchesApiService.list();
      setItems(response.items);
      setTotal(response.total);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load saved searches",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Skip fetching entirely for unauthenticated visitors so the UI can
    // render an empty state without a pointless 401.
    if (typeof document === "undefined") return;
    const hasAuth = document.cookie
      .split("; ")
      .some((row) => row.startsWith("auth-token="));
    if (!hasAuth) {
      setIsLoading(false);
      return;
    }
    void refresh();
  }, [refresh]);

  const createSearch = useCallback(
    async (payload: CreateSavedSearchPayload) => {
      setIsMutating(true);
      setError(null);
      try {
        const created = await SavedSearchesApiService.create(payload);
        setItems((prev) => [created, ...prev]);
        setTotal((prev) => prev + 1);
        return created;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to save search",
        );
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [],
  );

  const updateSearch = useCallback(
    async (id: string, payload: UpdateSavedSearchPayload) => {
      setIsMutating(true);
      setError(null);
      try {
        const updated = await SavedSearchesApiService.update(id, payload);
        setItems((prev) =>
          prev.map((item) => (item.id === id ? updated : item)),
        );
        return updated;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to update search",
        );
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [],
  );

  const deleteSearch = useCallback(async (id: string) => {
    setIsMutating(true);
    setError(null);
    // Optimistically remove the item so the UI feels snappy; restore on error.
    const prevItems = items;
    setItems((prev) => prev.filter((item) => item.id !== id));
    setTotal((prev) => Math.max(0, prev - 1));
    try {
      await SavedSearchesApiService.remove(id);
    } catch (err) {
      setItems(prevItems);
      setTotal(prevItems.length);
      setError(
        err instanceof Error ? err.message : "Failed to delete search",
      );
      throw err;
    } finally {
      setIsMutating(false);
    }
  }, [items]);

  const toggleNotifications = useCallback(
    async (id: string, enabled: boolean) => {
      setIsMutating(true);
      setError(null);
      const prevItems = items;
      // Optimistically flip the flag for immediate UI feedback.
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, notificationsEnabled: enabled } : item,
        ),
      );
      try {
        const updated = await SavedSearchesApiService.setNotifications(
          id,
          enabled,
        );
        setItems((prev) =>
          prev.map((item) => (item.id === id ? updated : item)),
        );
      } catch (err) {
        setItems(prevItems);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to toggle notifications",
        );
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [items],
  );

  return {
    items,
    total,
    isLoading,
    isMutating,
    error,
    refresh,
    createSearch,
    updateSearch,
    deleteSearch,
    toggleNotifications,
  };
}
