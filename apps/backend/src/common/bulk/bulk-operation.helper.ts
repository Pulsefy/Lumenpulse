import { BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

/** Maximum number of items allowed in a single bulk request. */
export const MAX_BATCH_SIZE = 100;

/** Result for one item within a bulk operation. */
export interface BulkItemResult<T = unknown> {
  /** The identifier supplied for this item (usually the entity ID). */
  id: string;
  /** Whether this individual item succeeded. */
  success: boolean;
  /** Returned data on success. */
  data?: T;
  /** Human-readable error message on failure. */
  error?: string;
}

/** Envelope returned by every bulk endpoint. */
export interface BulkOperationResult<T = unknown> {
  /** Unique ID for the entire bulk operation, referenced in each audit record. */
  bulkOperationId: string;
  /** Total number of items submitted. */
  total: number;
  /** Number of items that completed without error. */
  succeeded: number;
  /** Number of items that failed. */
  failed: number;
  /** Per-item results in the same order as the request. */
  results: BulkItemResult<T>[];
}

/**
 * Execute an async operation for each item in a batch, with per-item error
 * isolation.  A failure in one item never aborts the rest.
 *
 * @param ids       Array of entity IDs to process.
 * @param operation Async function to run per ID; receives `(id, bulkOperationId)`.
 * @returns         Aggregated {@link BulkOperationResult}.
 *
 * @throws BadRequestException immediately when the batch is empty or exceeds
 *         {@link MAX_BATCH_SIZE}.
 */
export async function executeBulkOperation<T>(
  ids: string[],
  operation: (id: string, bulkOperationId: string) => Promise<T>,
): Promise<BulkOperationResult<T>> {
  if (!ids || ids.length === 0) {
    throw new BadRequestException('ids array must not be empty');
  }

  if (ids.length > MAX_BATCH_SIZE) {
    throw new BadRequestException(
      `Batch size ${ids.length} exceeds the maximum of ${MAX_BATCH_SIZE}`,
    );
  }

  const bulkOperationId = uuidv4();
  const results: BulkItemResult<T>[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const id of ids) {
    try {
      const data = await operation(id, bulkOperationId);
      results.push({ id, success: true, data });
      succeeded++;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown error occurred';
      results.push({ id, success: false, error: message });
      failed++;
    }
  }

  return {
    bulkOperationId,
    total: ids.length,
    succeeded,
    failed,
    results,
  };
}
