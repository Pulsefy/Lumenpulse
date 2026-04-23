import { Injectable, Logger } from '@nestjs/common';
import { SnapshotRepository } from './snapshot.repository';
import { SnapshotRunResult } from './dto/snapshot.dto';

@Injectable()
export class SnapshotGenerator {
  private readonly logger = new Logger(SnapshotGenerator.name);

  constructor(private readonly snapshotRepo: SnapshotRepository) {}

  /**
   * Generate snapshots for a specific UTC date.
   *
   * Safe to call multiple times for the same date — the upsert ensures
   * existing rows are updated rather than duplicated.
   *
   * @param date  Target UTC calendar date. Time component is ignored.
   */
  async generateForDate(date: Date): Promise<SnapshotRunResult> {
    const utcDate = this.toUtcMidnight(date);
    const start = Date.now();

    this.logger.log(`Starting snapshot generation for ${this.fmt(utcDate)}`);

    const aggregations = await this.snapshotRepo.aggregateForDate(utcDate);

    if (aggregations.length === 0) {
      this.logger.warn(
        `No signal data found for ${this.fmt(utcDate)} — skipping write`,
      );
      return {
        date: utcDate,
        assetRowsWritten: 0,
        globalRowWritten: false,
        durationMs: Date.now() - start,
      };
    }

    const globalRow = aggregations.find((a) => a.assetSymbol === null);
    const assetRows = aggregations.filter((a) => a.assetSymbol !== null);

    const written = await this.snapshotRepo.upsertSnapshots(
      utcDate,
      aggregations,
    );

    const result: SnapshotRunResult = {
      date: utcDate,
      assetRowsWritten: assetRows.length,
      globalRowWritten: !!globalRow,
      durationMs: Date.now() - start,
    };

    this.logger.log(
      `Snapshot complete for ${this.fmt(utcDate)}: ` +
        `${result.assetRowsWritten} asset rows, ` +
        `global=${result.globalRowWritten}, ` +
        `${written} total upserted in ${result.durationMs}ms`,
    );

    return result;
  }

  /**
   * Generate snapshots for yesterday (UTC).
   *
   * This is the standard entry-point called by the scheduler — yesterday's
   * data is always complete by the time the nightly job runs.
   */
  async generateForYesterday(): Promise<SnapshotRunResult> {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return this.generateForDate(yesterday);
  }

  /**
   * Backfill snapshots for a date range (inclusive on both ends).
   *
   * Processes one day at a time to avoid query timeouts. Intended for
   * one-off backfills via an admin endpoint or CLI script.
   */
  async backfill(from: Date, to: Date): Promise<SnapshotRunResult[]> {
    const results: SnapshotRunResult[] = [];
    const cursor = this.toUtcMidnight(from);
    const end = this.toUtcMidnight(to);

    while (cursor <= end) {
      const result = await this.generateForDate(new Date(cursor));
      results.push(result);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return results;
  }

  private toUtcMidnight(d: Date): Date {
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
  }

  private fmt(d: Date): string {
    return d.toISOString().split('T')[0];
  }
}
