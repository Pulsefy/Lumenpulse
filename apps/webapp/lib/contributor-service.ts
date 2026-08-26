/**
 * ContributorApiService
 *
 * Fetches contributor profile data by aggregating endpoints:
 *  - /contributor-feed (activity feed filtered by address)
 *  - /verification/projects (verification status for projects the contributor owns)
 *  - /grants/rounds + /grants/rounds/:id/export (contribution aggregates)
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContributorActivity {
  id: string;
  activityType:
    | "contributor_registered"
    | "grant_contribution"
    | "reputation_change";
  contributorAddress: string;
  githubHandle?: string;
  timestamp: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface ContributorFeedResponse {
  items: ContributorActivity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  isSparseContributor: boolean;
}

export interface ContributorProfile {
  address: string;
  activities: ContributorActivity[];
  totalActivities: number;
  isSparseContributor: boolean;
  aggregates: {
    totalContributed: number;
    transactionsCount: number;
    projectsSupported: number;
  };
}

// ── Service ──────────────────────────────────────────────────────────────────

export class ContributorApiService {
  /**
   * Fetch the aggregated contributor profile for a given Stellar address.
   */
  static async getProfile(address: string): Promise<ContributorProfile> {
    const [feed, aggregates] = await Promise.all([
      ContributorApiService.getFeed(address),
      ContributorApiService.getAggregates(address),
    ]);

    return {
      address,
      activities: feed.items,
      totalActivities: feed.total,
      isSparseContributor: feed.isSparseContributor,
      aggregates,
    };
  }

  /**
   * Fetch the contributor activity feed for a specific address.
   */
  static async getFeed(address: string): Promise<ContributorFeedResponse> {
    const qs = new URLSearchParams({
      contributorAddress: address,
      limit: "10",
      page: "1",
    });

    const res = await fetch(`${API_BASE}/contributor-feed?${qs}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch contributor feed (${res.status})`);
    }
    return res.json();
  }

  /**
   * Compute aggregate contribution stats for a contributor by scanning grant rounds.
   */
  static async getAggregates(address: string): Promise<{
    totalContributed: number;
    transactionsCount: number;
    projectsSupported: number;
  }> {
    const roundsRes = await fetch(`${API_BASE}/grants/rounds`);
    if (!roundsRes.ok) {
      return {
        totalContributed: 0,
        transactionsCount: 0,
        projectsSupported: 0,
      };
    }
    const rounds: { id: number }[] = await roundsRes.json();

    const exports = await Promise.all(
      rounds.map(async (r) => {
        const res = await fetch(`${API_BASE}/grants/rounds/${r.id}/export`);
        if (!res.ok) return null;
        return res.json() as Promise<{
          contributions: {
            contributorPublicKey: string;
            amount: number;
            projectId: number;
          }[];
        }>;
      }),
    );

    let totalContributedRaw = BigInt(0);
    let txCount = 0;
    const projects = new Set<number>();

    exports.forEach((exp) => {
      if (!exp) return;
      exp.contributions.forEach((c) => {
        if (c.contributorPublicKey.toLowerCase() === address.toLowerCase()) {
          totalContributedRaw += BigInt(c.amount);
          txCount++;
          projects.add(c.projectId);
        }
      });
    });

    return {
      totalContributed: Number(totalContributedRaw) / 10_000_000,
      transactionsCount: txCount,
      projectsSupported: projects.size,
    };
  }
}
