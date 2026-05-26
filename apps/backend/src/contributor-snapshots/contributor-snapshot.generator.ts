import { Injectable, Logger } from '@nestjs/common';
import { ContributorSnapshotRepository } from './contributor-snapshot.repository';
import { ContributorSnapshotRunResult } from './dto/contributor-snapshot.dto';

@Injectable()
export class ContributorSnapshotGenerator {
  private readonly logger = new Logger(ContributorSnapshotGenerator.name);

  constructor(private readonly repo: ContributorSnapshotRepository) {}

  /**
   * Generate contributor reputation snapshots for a specific UTC date.
   *
   * Safe to call multiple times for the same date — the upsert ensures
   * existing rows are updated rather than duplicated.
   */
  async generateForDate(date: Date): Promise<ContributorSnapshotRunResult> {
    const utcDate = this.toUtcMidnight(date);
    const start = Date.now();

    this.logger.log(
      `Starting contributor snapshot generation for ${this.fmt(utcDate)}`,
    );

    const aggregations = await this.repo.aggregateForDate(utcDate);

    if (aggregations.length === 0) {
      this.logger.warn(
        `No contributor data found for ${this.fmt(utcDate)} — skipping write`,
      );
      return { date: utcDate, rowsWritten: 0, durationMs: Date.now() - start };
    }

    const written = await this.repo.upsertSnapshots(utcDate, aggregations);

    const result: ContributorSnapshotRunResult = {
      date: utcDate,
      rowsWritten: written,
      durationMs: Date.now() - start,
    };

    this.logger.log(
      `Contributor snapshot complete for ${this.fmt(utcDate)}: ` +
        `${written} rows upserted in ${result.durationMs}ms`,
    );

    return result;
  }

  /**
   * Generate snapshots for yesterday (UTC).
   * Standard entry-point called by the scheduler.
   */
  async generateForYesterday(): Promise<ContributorSnapshotRunResult> {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return this.generateForDate(yesterday);
  }

  /**
   * Backfill snapshots for a date range (inclusive on both ends).
   */
  async backfill(
    from: Date,
    to: Date,
  ): Promise<ContributorSnapshotRunResult[]> {
    const results: ContributorSnapshotRunResult[] = [];
    const cursor = this.toUtcMidnight(from);
    const end = this.toUtcMidnight(to);

    while (cursor <= end) {
      results.push(await this.generateForDate(new Date(cursor)));
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
