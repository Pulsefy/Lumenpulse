// Client for GET /review-metrics/aging.
//
// Shapes mirror apps/backend/src/review-metrics/dto/review-metrics.dto.ts.

import { getAuthToken } from "@/lib/auth-role";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type ReviewDomain = "moderation" | "anomaly";

export interface AgingBucket {
  label: string;
  minHours: number;
  maxHours: number | null;
  count: number;
}

export interface DomainAgingSnapshot {
  domain: ReviewDomain;
  totalOpen: number;
  averageAgeMs: number;
  medianAgeMs: number | null;
  oldestAgeMs: number | null;
  newestAgeMs: number | null;
  buckets: AgingBucket[];
}

export interface ReviewMetricsResponse {
  computedAt: string;
  domains: DomainAgingSnapshot[];
  grandTotalOpen: number;
}

/** Default hours after which a pending item is flagged as overdue. */
export const DEFAULT_AGING_THRESHOLD_HOURS = (() => {
  const parsed = Number(process.env.NEXT_PUBLIC_REVIEW_AGING_THRESHOLD_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 72;
})();

export class ReviewMetricsApiService {
  static async getAging(domain?: ReviewDomain): Promise<ReviewMetricsResponse | null> {
    const token = getAuthToken();
    const params = domain ? `?domain=${domain}` : "";
    const response = await fetch(`${API_BASE}/review-metrics/aging${params}`, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (response.status === 204 || response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Failed to fetch review aging metrics: ${response.status}`);
    }

    const data = (await response.json().catch(() => null)) as ReviewMetricsResponse | null;
    if (!data || !Array.isArray(data.domains)) return null;
    return data;
  }
}

/**
 * Sum bucket counts across domains, keyed by bucket label and kept in the
 * order the backend returns them.
 */
export function combineBuckets(domains: DomainAgingSnapshot[]): AgingBucket[] {
  const combined = new Map<string, AgingBucket>();
  for (const domain of domains) {
    for (const bucket of domain.buckets ?? []) {
      const existing = combined.get(bucket.label);
      if (existing) {
        existing.count += bucket.count;
      } else {
        combined.set(bucket.label, { ...bucket });
      }
    }
  }
  return Array.from(combined.values()).sort((a, b) => a.minHours - b.minHours);
}

/** A bucket is overdue once every item in it is at least `thresholdHours` old. */
export function isBucketOverdue(bucket: AgingBucket, thresholdHours: number): boolean {
  return bucket.minHours >= thresholdHours;
}

export function formatAge(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
