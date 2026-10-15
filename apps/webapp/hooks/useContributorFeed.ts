"use client";

import { useState, useEffect, useCallback } from "react";
import type { components } from "@/generated/openapi-types";
import { clientConfig } from "@/lib/config";

const API_BASE = clientConfig.apiUrl;

export type FeedActivityItem = components["schemas"]["FeedActivityItemDto"];
export type ContributorFeedResponse = components["schemas"]["ContributorFeedResponseDto"];
export type FeedActivityType = components["schemas"]["FeedActivityType"];
export type FeedSortOrder = "ASC" | "DESC";

export interface ContributorFeedQuery {
  page?: number;
  limit?: number;
  activityType?: FeedActivityType;
  contributorAddress?: string;
  sortOrder?: FeedSortOrder;
}

export function useContributorFeed(initialQuery: ContributorFeedQuery = {}) {
  const [data, setData] = useState<ContributorFeedResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<ContributorFeedQuery>({
    page: 1,
    limit: 20,
    sortOrder: "DESC",
    ...initialQuery,
  });

  const fetchFeed = useCallback(async (q: ContributorFeedQuery) => {
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (q.page) params.set("page", q.page.toString());
    if (q.limit) params.set("limit", q.limit.toString());
    if (q.activityType) params.set("activityType", q.activityType);
    if (q.contributorAddress) params.set("contributorAddress", q.contributorAddress);
    if (q.sortOrder) params.set("sortOrder", q.sortOrder);

    try {
      const res = await fetch(`${API_BASE}/contributor-feed?${params}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch contributor feed (${res.status})`);
      }
      const result = await res.json();
      setData(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch feed";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeed(query);
  }, [fetchFeed, query.page, query.activityType, query.contributorAddress, query.sortOrder]);

  const loadMore = useCallback(async () => {
    if (!data || data.page >= data.totalPages) return null;
    const nextPage = data.page + 1;
    setQuery((prev) => ({ ...prev, page: nextPage }));
    return fetchFeed({ ...query, page: nextPage });
  }, [data, query, fetchFeed]);

  const refresh = useCallback(() => fetchFeed({ ...query, page: 1 }), [fetchFeed, query]);

  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? 1,
    limit: data?.limit ?? 20,
    totalPages: data?.totalPages ?? 0,
    isSparseContributor: data?.isSparseContributor ?? false,
    isLoading,
    error,
    query,
    setQuery,
    loadMore,
    refresh,
  };
}