// Pure queue-health classification (Issue #1434), driven by real BullMQ
// queue stats or unit-test fixtures alike.
export type QueueHealthStatus = 'healthy' | 'backlogged' | 'stalled';

export interface QueueHealthThresholds {
  maxDepth: number;
  maxOldestJobAgeMs: number;
}
export interface QueueHealthResult {
  status: QueueHealthStatus;
  reason: string;
}

export const DEFAULT_QUEUE_HEALTH_THRESHOLDS: QueueHealthThresholds = {
  maxDepth: 1000,
  maxOldestJobAgeMs: 10 * 60 * 1000,
};

/** Detects a stalled or backlogged worker from metrics alone. */
export function classifyQueueHealth(
  depth: number,
  oldestJobAgeMs: number,
  thresholds: QueueHealthThresholds = DEFAULT_QUEUE_HEALTH_THRESHOLDS,
): QueueHealthResult {
  if (oldestJobAgeMs > thresholds.maxOldestJobAgeMs) {
    return {
      status: 'stalled',
      reason: `oldest job age ${oldestJobAgeMs}ms exceeds ${thresholds.maxOldestJobAgeMs}ms`,
    };
  }

  if (depth > thresholds.maxDepth) {
    return {
      status: 'backlogged',
      reason: `depth ${depth} exceeds ${thresholds.maxDepth}`,
    };
  }

  return { status: 'healthy', reason: 'within depth and age thresholds' };
}
