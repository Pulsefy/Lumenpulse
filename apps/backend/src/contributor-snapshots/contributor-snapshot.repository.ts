import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ContributorSnapshot } from './entities/contributor-snapshot.entity';
import {
  ContributorAggregation,
  ContributorAggregationRow,
  LeaderboardEntry,
} from './dto/contributor-snapshot.dto';

@Injectable()
export class ContributorSnapshotRepository {
  constructor(
    @InjectRepository(ContributorSnapshot)
    private readonly repo: Repository<ContributorSnapshot>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Aggregate contributor reputation data from the testnet sync tables.
   *
   * Reads from `stellar_contributor_registry` — the table populated by
   * StellarSyncProcessor when it ingests contributor_registry contract events.
   * Falls back gracefully to an empty array when the table has no rows for
   * the given date (e.g. testnet is quiet).
   */
  async aggregateForDate(utcDate: Date): Promise<ContributorAggregation[]> {
    const dateStr = this.toDateString(utcDate);

    const raw: ContributorAggregationRow[] = await this.dataSource.query(
      `
      SELECT
        contributor_address,
        github_handle,
        reputation_score::text,
        registered_timestamp::text
      FROM stellar_contributor_registry
      WHERE DATE(synced_at AT TIME ZONE 'UTC') <= $1
        AND contributor_address IS NOT NULL
      -- Keep only the most recent row per contributor up to the snapshot date
      ORDER BY contributor_address, synced_at DESC
      `,
      [dateStr],
    );

    // Deduplicate: keep the latest row per contributor_address
    const seen = new Set<string>();
    const deduped = raw.filter((r) => {
      if (seen.has(r.contributor_address)) return false;
      seen.add(r.contributor_address);
      return true;
    });

    return deduped.map(this.parseRow);
  }

  /**
   * Upsert a batch of aggregations for `utcDate`.
   * Ranks are assigned in descending reputation_score order before writing.
   */
  async upsertSnapshots(
    utcDate: Date,
    aggregations: ContributorAggregation[],
  ): Promise<number> {
    if (aggregations.length === 0) return 0;

    // Sort descending by score to assign ranks
    const sorted = [...aggregations].sort(
      (a, b) => b.reputationScore - a.reputationScore,
    );

    const entities: Partial<ContributorSnapshot>[] = sorted.map((agg, i) => ({
      snapshotDate: utcDate,
      contributorAddress: agg.contributorAddress,
      githubHandle: agg.githubHandle,
      reputationScore: agg.reputationScore,
      rank: i + 1,
      registeredTimestamp: agg.registeredTimestamp,
    }));

    await this.repo
      .createQueryBuilder()
      .insert()
      .into(ContributorSnapshot)
      .values(entities)
      .orUpdate(
        ['github_handle', 'reputation_score', 'rank', 'registered_timestamp', 'updated_at'],
        ['snapshot_date', 'contributor_address'],
      )
      .execute();

    return entities.length;
  }

  /**
   * Return the top-N contributors for a given snapshot date.
   * If `date` is omitted, uses the most recent snapshot date available.
   */
  async findTopN(limit: number, date?: Date): Promise<LeaderboardEntry[]> {
    const qb = this.repo.createQueryBuilder('cs');

    if (date) {
      qb.where('cs.snapshot_date = :date', {
        date: this.toDateString(date),
      });
    } else {
      // Subquery: pick the latest snapshot date
      qb.where(
        'cs.snapshot_date = (SELECT MAX(snapshot_date) FROM contributor_snapshots)',
      );
    }

    const rows = await qb
      .orderBy('cs.rank', 'ASC')
      .limit(Math.min(limit, 100))
      .getMany();

    return rows.map((r) => ({
      rank: r.rank ?? 0,
      contributorAddress: r.contributorAddress,
      githubHandle: r.githubHandle,
      reputationScore: Number(r.reputationScore),
      snapshotDate: this.toDateString(r.snapshotDate),
    }));
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private toDateString(d: Date): string {
    return d.toISOString().split('T')[0];
  }

  private parseRow(
    this: void,
    row: ContributorAggregationRow,
  ): ContributorAggregation {
    return {
      contributorAddress: row.contributor_address,
      githubHandle: row.github_handle ?? null,
      reputationScore: parseInt(row.reputation_score, 10),
      registeredTimestamp:
        row.registered_timestamp !== null
          ? parseInt(row.registered_timestamp, 10)
          : null,
    };
  }
}
