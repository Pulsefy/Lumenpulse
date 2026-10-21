import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MetricsService } from '../metrics/metrics.service';
import { config } from '../lib/config';

/**
 * Compares the transactional outbox with the soroban event index.
 *
 * An outbox event refers to a chain operation when its payload carries
 * `txHash` (and optionally `eventIndex`, the position of the event within the
 * transaction — the same key the indexer uses). Three kinds of discrepancy are
 * reported:
 *
 * - `published_not_indexed`: an outbox event names a chain event the index
 *   does not hold.
 * - `indexed_not_published`: an indexed event of a type listed in
 *   `OUTBOX_INDEX_CHECK_REQUIRED_TYPES` has no outbox event.
 * - `duplicate_publish`: one chain event was published more than once. The
 *   index cannot double-count, because `(txHash, eventIndex)` is unique.
 *
 * Every query is windowed and capped at `maxRows`, so one run costs a bounded
 * number of index lookups regardless of table size.
 */

export const OUTBOX_INDEX_DATASET = 'outbox_event_index';

/** Keeps each `= ANY($1)` lookup to a modest parameter size. */
const LOOKUP_CHUNK = 500;

export type DiscrepancyKind =
  | 'published_not_indexed'
  | 'indexed_not_published'
  | 'duplicate_publish';

export interface OutboxChainRef {
  outboxEventId: string;
  outboxEventType: string;
  outboxStatus: string;
  createdAt: string;
  txHash: string;
  /** null when the outbox event refers to the transaction as a whole. */
  eventIndex: number | null;
}

export interface IndexedChainEvent {
  sorobanEventId: string;
  txHash: string;
  eventIndex: number;
  canonicalType: string | null;
  eventType: string | null;
  ledgerSequence: string | null;
}

export interface Discrepancy {
  kind: DiscrepancyKind;
  txHash: string;
  eventIndex: number | null;
  outboxEventIds: string[];
  outboxEventType?: string;
  sorobanEventId?: string;
  canonicalType?: string | null;
  ledgerSequence?: string | null;
}

export interface ConsistencyCheckResult {
  windowStart: string;
  windowEnd: string;
  outboxEventsChecked: number;
  indexedEventsChecked: number;
  /**
   * True when a query hit `maxRows`. Rows past the cap were not compared, so
   * this raises a warning: raise the cap or shorten the window.
   */
  truncated: boolean;
  counts: Record<DiscrepancyKind, number>;
  discrepancies: Discrepancy[];
}

/**
 * Pure comparison. `indexedForRefs` must contain every indexed row whose
 * txHash appears in `refs`; `requiredEvents` are the indexed events that must
 * each have an outbox counterpart.
 */
export function compareOutboxWithIndex(
  refs: OutboxChainRef[],
  indexedForRefs: IndexedChainEvent[],
  requiredEvents: IndexedChainEvent[],
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  const indexedKeys = new Set(
    indexedForRefs.map((e) => `${e.txHash}:${e.eventIndex}`),
  );
  const indexedTx = new Set(indexedForRefs.map((e) => e.txHash));

  for (const ref of refs) {
    const found =
      ref.eventIndex === null
        ? indexedTx.has(ref.txHash)
        : indexedKeys.has(`${ref.txHash}:${ref.eventIndex}`);
    if (!found) {
      discrepancies.push({
        kind: 'published_not_indexed',
        txHash: ref.txHash,
        eventIndex: ref.eventIndex,
        outboxEventIds: [ref.outboxEventId],
        outboxEventType: ref.outboxEventType,
      });
    }
  }

  const groups = new Map<string, OutboxChainRef[]>();
  for (const ref of refs) {
    const key = `${ref.outboxEventType}|${ref.txHash}|${ref.eventIndex ?? '*'}`;
    const group = groups.get(key) ?? [];
    group.push(ref);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    discrepancies.push({
      kind: 'duplicate_publish',
      txHash: group[0].txHash,
      eventIndex: group[0].eventIndex,
      outboxEventIds: group.map((r) => r.outboxEventId),
      outboxEventType: group[0].outboxEventType,
    });
  }

  const refsByTx = new Map<string, OutboxChainRef[]>();
  for (const ref of refs) {
    const list = refsByTx.get(ref.txHash) ?? [];
    list.push(ref);
    refsByTx.set(ref.txHash, list);
  }
  for (const event of requiredEvents) {
    const published = (refsByTx.get(event.txHash) ?? []).some(
      (r) => r.eventIndex === null || r.eventIndex === event.eventIndex,
    );
    if (!published) {
      discrepancies.push({
        kind: 'indexed_not_published',
        txHash: event.txHash,
        eventIndex: event.eventIndex,
        outboxEventIds: [],
        sorobanEventId: event.sorobanEventId,
        canonicalType: event.canonicalType,
        ledgerSequence: event.ledgerSequence,
      });
    }
  }

  return discrepancies;
}

interface OutboxRow {
  id: string;
  eventType: string;
  status: string;
  createdAt: Date | string;
  txHash: string;
  eventIndex: string | null;
}

interface SorobanRow {
  id: string;
  txHash: string;
  eventIndex: number;
  canonicalType: string | null;
  eventType: string | null;
  ledgerSequence: string | null;
}

const OUTBOX_COLUMNS = `"id", "eventType", "status", "createdAt",
  "payload"->>'txHash' AS "txHash", "payload"->>'eventIndex' AS "eventIndex"`;

const SOROBAN_COLUMNS = `"id", "txHash", "eventIndex", "canonicalType", "eventType", "ledgerSequence"`;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function toRef(row: OutboxRow): OutboxChainRef {
  const index = row.eventIndex === null ? NaN : Number(row.eventIndex);
  return {
    outboxEventId: row.id,
    outboxEventType: row.eventType,
    outboxStatus: row.status,
    createdAt: new Date(row.createdAt).toISOString(),
    txHash: row.txHash,
    eventIndex: Number.isInteger(index) ? index : null,
  };
}

function toIndexed(row: SorobanRow): IndexedChainEvent {
  return {
    sorobanEventId: row.id,
    txHash: row.txHash,
    eventIndex: Number(row.eventIndex),
    canonicalType: row.canonicalType,
    eventType: row.eventType,
    ledgerSequence:
      row.ledgerSequence === null ? null : String(row.ledgerSequence),
  };
}

@Injectable()
export class OutboxIndexConsistencyService {
  private readonly logger = new Logger(OutboxIndexConsistencyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly metricsService: MetricsService,
  ) {}

  async runCheck(now: Date = new Date()): Promise<ConsistencyCheckResult> {
    const { windowMinutes, settleMinutes, maxRows, requiredTypes } =
      config.outboxIndexCheck;
    const windowEnd = new Date(now.getTime() - settleMinutes * 60_000);
    const windowStart = new Date(windowEnd.getTime() - windowMinutes * 60_000);

    // 1. Outbox events in the window that name a chain operation. Served by
    //    the partial createdAt index on rows with a txHash.
    const outboxRows: OutboxRow[] = await this.dataSource.query(
      `SELECT ${OUTBOX_COLUMNS} FROM "outbox_events"
        WHERE "payload" ? 'txHash'
          AND "createdAt" >= $1 AND "createdAt" < $2
        ORDER BY "createdAt" ASC
        LIMIT $3`,
      [windowStart, windowEnd, maxRows + 1],
    );
    let truncated = outboxRows.length > maxRows;
    const refs = outboxRows.slice(0, maxRows).map(toRef);

    // 2. Indexed events that must have been published, by processedAt.
    let required: IndexedChainEvent[] = [];
    if (requiredTypes.length > 0) {
      const rows: SorobanRow[] = await this.dataSource.query(
        `SELECT ${SOROBAN_COLUMNS} FROM "soroban_events"
          WHERE "canonicalType" = ANY($1)
            AND "processedAt" >= $2 AND "processedAt" < $3
          ORDER BY "processedAt" ASC
          LIMIT $4`,
        [requiredTypes, windowStart, windowEnd, maxRows + 1],
      );
      truncated = truncated || rows.length > maxRows;
      required = rows.slice(0, maxRows).map(toIndexed);

      // Their outbox events may have been written outside the window; looked
      // up through the partial ("payload"->>'txHash') index.
      const known = new Set(refs.map((r) => r.txHash));
      const missingTx = [
        ...new Set(required.map((e) => e.txHash).filter((h) => !known.has(h))),
      ];
      for (const hashes of chunk(missingTx, LOOKUP_CHUNK)) {
        const extra: OutboxRow[] = await this.dataSource.query(
          `SELECT ${OUTBOX_COLUMNS} FROM "outbox_events"
            WHERE "payload" ? 'txHash' AND "payload"->>'txHash' = ANY($1)`,
          [hashes],
        );
        refs.push(...extra.map(toRef));
      }
    }

    // 3. Index rows for every referenced transaction (unique txHash index).
    const indexed: IndexedChainEvent[] = [];
    const txHashes = [...new Set(refs.map((r) => r.txHash))];
    for (const hashes of chunk(txHashes, LOOKUP_CHUNK)) {
      const rows: SorobanRow[] = await this.dataSource.query(
        `SELECT ${SOROBAN_COLUMNS} FROM "soroban_events" WHERE "txHash" = ANY($1)`,
        [hashes],
      );
      indexed.push(...rows.map(toIndexed));
    }

    const discrepancies = compareOutboxWithIndex(refs, indexed, required);
    const counts: Record<DiscrepancyKind, number> = {
      published_not_indexed: 0,
      indexed_not_published: 0,
      duplicate_publish: 0,
    };
    for (const d of discrepancies) counts[d.kind] += 1;

    this.report(counts, discrepancies, truncated);

    return {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      outboxEventsChecked: refs.length,
      indexedEventsChecked: indexed.length + required.length,
      truncated,
      counts,
      discrepancies,
    };
  }

  /**
   * Alerts go through the reconciliation drift counter, which
   * prometheus-rules.yml already alerts on per dataset.
   */
  private report(
    counts: Record<DiscrepancyKind, number>,
    discrepancies: Discrepancy[],
    truncated: boolean,
  ): void {
    const missing = counts.published_not_indexed + counts.indexed_not_published;
    if (missing > 0) {
      this.metricsService.recordReconciliationDrift(
        OUTBOX_INDEX_DATASET,
        'critical',
        missing,
      );
    }
    if (counts.duplicate_publish > 0) {
      this.metricsService.recordReconciliationDrift(
        OUTBOX_INDEX_DATASET,
        'warning',
        counts.duplicate_publish,
      );
    }
    if (truncated) {
      this.metricsService.recordReconciliationDrift(
        OUTBOX_INDEX_DATASET,
        'warning',
        config.outboxIndexCheck.maxRows,
      );
      this.logger.warn(
        `Outbox/index check hit the ${config.outboxIndexCheck.maxRows}-row cap; rows past it were not compared. ` +
          'Raise OUTBOX_INDEX_CHECK_MAX_ROWS or shorten OUTBOX_INDEX_CHECK_WINDOW_MINUTES.',
      );
    }
    for (const d of discrepancies.slice(0, 100)) {
      this.logger.warn(`Outbox/index discrepancy ${JSON.stringify(d)}`);
    }
  }
}
