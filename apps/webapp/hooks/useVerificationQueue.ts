"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  OPEN_STATUSES,
  VerificationRequestApiService,
  type ProjectVoteState,
  type VerificationDecision,
  type VerificationRequest,
  type VerificationRequestStatus,
} from "@/lib/verification-request-service";

export type QueueFilter = "OPEN" | "ALL" | VerificationRequestStatus;

export const DEFAULT_POLL_INTERVAL_MS = 15_000;

export function matchesFilter(request: VerificationRequest, filter: QueueFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "OPEN") return OPEN_STATUSES.includes(request.status);
  return request.status === filter;
}

interface UseVerificationQueueOptions {
  enabled: boolean;
  filter: QueueFilter;
  /** 0 disables polling. */
  pollIntervalMs?: number;
}

/**
 * Loads the reviewer queue, keeps it fresh by polling while the tab is
 * visible, and applies decisions in place so state changes show without a
 * page reload.
 */
export function useVerificationQueue({
  enabled,
  filter,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseVerificationQueueOptions) {
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [voteStates, setVoteStates] = useState<Record<string, ProjectVoteState | null>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const loadVoteStates = useCallback(async (items: VerificationRequest[]) => {
    const projectIds = Array.from(
      new Set(items.filter((r) => r.targetType === "PROJECT").map((r) => r.targetId)),
    );
    const results = await Promise.allSettled(
      projectIds.map((id) => VerificationRequestApiService.getProjectVoteState(id)),
    );
    setVoteStates((prev) => {
      const next = { ...prev };
      results.forEach((result, i) => {
        // Keep the last known tally if a refresh of it fails.
        if (result.status === "fulfilled") next[projectIds[i]] = result.value;
      });
      return next;
    });
  }, []);

  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const seq = ++loadSeq.current;
      if (!silent) setIsLoading(true);
      try {
        // The API filters by a single status; open/all are filtered here.
        const status = filter === "OPEN" || filter === "ALL" ? undefined : filter;
        const items = await VerificationRequestApiService.list(status);
        if (seq !== loadSeq.current) return; // a newer load superseded this one
        setRequests(items);
        setError(null);
        setLastUpdated(new Date());
        void loadVoteStates(items);
      } catch (err) {
        if (seq !== loadSeq.current) return;
        // A failed background refresh keeps the list on screen.
        if (!silent) setRequests([]);
        setError(err instanceof Error ? err.message : "Failed to load verification requests");
      } finally {
        if (seq === loadSeq.current) setIsLoading(false);
      }
    },
    [filter, loadVoteStates],
  );

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled || pollIntervalMs <= 0) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load({ silent: true });
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [enabled, load, pollIntervalMs]);

  const decide = useCallback(
    async (id: string, decision: VerificationDecision): Promise<VerificationRequest> => {
      setDecidingId(id);
      try {
        const updated = await VerificationRequestApiService.decide(id, decision);
        // Drop any in-flight list load so it can't overwrite the new state.
        loadSeq.current++;
        setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
        setLastUpdated(new Date());
        return updated;
      } finally {
        setDecidingId(null);
      }
    },
    [],
  );

  return {
    requests: requests.filter((r) => matchesFilter(r, filter)),
    voteStates,
    isLoading,
    error,
    lastUpdated,
    decidingId,
    refresh: () => load(),
    decide,
  };
}
