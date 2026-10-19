import { apiClient, ApiResponse } from './api-client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GrantRound {
  id: number;
  name: string;
  tokenAddress: string;
  startTime: number;
  endTime: number;
  totalPool: string;
  isFinalized: boolean;
  isDistributed: boolean;
  status: 'DRAFT' | 'OPEN' | 'MATCHING' | 'CLOSED' | 'DISBURSED';
}

export interface ProjectQf {
  projectId: number;
  qfScore: string;
  totalContributions: string;
  contributorCount: number;
  estimatedMatch: string;
}

export interface RoundSummary {
  round: GrantRound;
  poolBalance: string;
  participationMetrics: {
    totalContributors: number;
    totalContributionAmount: string;
    totalContributionRecords: number;
    totalProjectsWithContributions: number;
    averageContributionPerContributor: string;
    averageContributionPerProject: string;
  };
  projects: ProjectQf[];
}

// ── API ──────────────────────────────────────────────────────────────────────

export const grantsApi = {
  listRounds(): Promise<ApiResponse<GrantRound[]>> {
    return apiClient.get<GrantRound[]>('/grants/rounds');
  },

  getRound(roundId: number): Promise<ApiResponse<GrantRound>> {
    return apiClient.get<GrantRound>(`/grants/rounds/${roundId}`);
  },

  getRoundSummary(roundId: number): Promise<ApiResponse<RoundSummary>> {
    return apiClient.get<RoundSummary>(`/grants/rounds/${roundId}/summary`);
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format a raw token amount (7 decimals for XLM/Soroban tokens) */
export function formatPoolAmount(raw: string, decimals = 7): string {
  const n = Number(raw) / Math.pow(10, decimals);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

/** Percentage share of the pool for a project */
export function matchShare(estimatedMatch: string, poolBalance: string): number {
  const pool = Number(poolBalance);
  if (pool === 0) return 0;
  return Math.min(100, (Number(estimatedMatch) / pool) * 100);
}

/** Human-readable round status label */
export function roundStatusLabel(
  status: GrantRound['status'],
  t?: (key: string) => string,
): string {
  const labels: Record<GrantRound['status'], string> = {
    DRAFT: t ? t('grants.status.pending') : 'Upcoming',
    OPEN: t ? t('grants.status.active') : 'Active',
    MATCHING: t ? t('grants.status.matching') : 'Matching',
    CLOSED: t ? t('grants.status.finalized') : 'Finalized',
    DISBURSED: t ? t('grants.status.distributed') : 'Distributed',
  };
  return labels[status] ?? status;
}
