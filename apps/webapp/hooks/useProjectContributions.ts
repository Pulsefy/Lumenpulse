"use client";

import { useState, useEffect, useCallback } from "react";

import { clientConfig } from '@/lib/config';

const API_BASE = clientConfig.apiUrl;

export interface ContributionRecord {
  projectId: number;
  contributor: string;
  amount: string;
  timestamp: string;
  transactionHash: string;
}

export interface UseProjectContributionsReturn {
  contributions: ContributionRecord[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useProjectContributions(
  projectId: number,
  publicKey?: string | null
): UseProjectContributionsReturn {
  const [contributions, setContributions] = useState<ContributionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchContributions = useCallback(async () => {
    if (!publicKey) {
      setContributions([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(
        `${API_BASE}/crowdfund/projects/${projectId}/contributions/${publicKey}`
      );

      if (!response.ok) {
        if (response.status === 404) {
          setContributions([]);
          return;
        }
        throw new Error(`Failed to load contributions: ${response.statusText}`);
      }

      const data = await response.json();
      setContributions(data);
    } catch (err: any) {
      setError(err.message || "Failed to load contributions");
      setContributions([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, publicKey]);

  useEffect(() => {
    fetchContributions();
  }, [fetchContributions]);

  const refresh = useCallback(async () => {
    await fetchContributions();
  }, [fetchContributions]);

  return {
    contributions,
    isLoading,
    error,
    refresh,
  };
}