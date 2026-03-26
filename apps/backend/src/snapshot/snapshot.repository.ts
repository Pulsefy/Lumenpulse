import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DailySnapshot } from './entities/daily-snapshot.entity';
import { AssetAggregation, AssetAggregationRow } from './dto/snapshot.dto';

@Injectable()
export class SnapshotRepository {
  constructor(
    @InjectRepository(DailySnapshot)
    private readonly repo: Repository<DailySnapshot>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Run a single SQL aggregation that produces one row per asset_symbol
   * for the given UTC calendar date, plus a global NULL row.
   *
   * The UNION ALL approach lets us get per-asset and global in one round-trip.
   *
   * Adjust `sentiment_signals` / column names to match your actual schema.
   */
  async aggregateForDate(utcDate: Date): Promise<AssetAggregation[]> {
    const dateStr = this.toDateString(utcDate);

    const raw: AssetAggregationRow[] = await this.dataSource.query(
      `
      -- Per-asset aggregation
      SELECT
        asset_symbol,
        AVG(sentiment_score)::text                          AS avg_sentiment,
        MIN(sentiment_score)::text                          AS min_sentiment,
        MAX(sentiment_score)::text                          AS max_sentiment,
        COUNT(*)::text                                      AS signal_count,
        SUM(volume)::text                                   AS total_volume,
        CASE
          WHEN SUM(volume) > 0
          THEN (SUM(sentiment_score * volume) / SUM(volume))::text
          ELSE NULL
        END                                                  AS volume_weighted_sentiment
      FROM sentiment_signals
      WHERE DATE(signal_timestamp AT TIME ZONE 'UTC') = $1
        AND asset_symbol IS NOT NULL
      GROUP BY asset_symbol

      UNION ALL

      -- Global (cross-asset) row — asset_symbol is NULL
      SELECT
        NULL                                                AS asset_symbol,
        AVG(sentiment_score)::text                          AS avg_sentiment,
        MIN(sentiment_score)::text                          AS min_sentiment,
        MAX(sentiment_score)::text                          AS max_sentiment,
        COUNT(*)::text                                      AS signal_count,
        SUM(volume)::text                                   AS total_volume,
        CASE
          WHEN SUM(volume) > 0
          THEN (SUM(sentiment_score * volume) / SUM(volume))::text
          ELSE NULL
        END                                                  AS volume_weighted_sentiment
      FROM sentiment_signals
      WHERE DATE(signal_timestamp AT TIME ZONE 'UTC') = $1
      `,
      [dateStr],
    );

    return raw.map(this.parseRow);
  }

  /**
   * Write a batch of aggregations for `utcDate` using an upsert so that
   * re-running the job for the same date updates existing rows rather than
   * throwing a unique-constraint error.
   */
  async upsertSnapshots(
    utcDate: Date,
    aggregations: AssetAggregation[],
  ): Promise<number> {
    if (aggregations.length === 0) return 0;

    const entities: Partial<DailySnapshot>[] = aggregations.map((agg) => ({
      snapshotDate: utcDate,
      assetSymbol: agg.assetSymbol,
      avgSentiment: agg.avgSentiment,
      minSentiment: agg.minSentiment,
      maxSentiment: agg.maxSentiment,
      signalCount: agg.signalCount,
      totalVolume: agg.totalVolume,
      volumeWeightedSentiment: agg.volumeWeightedSentiment,
    }));

    await this.repo
      .createQueryBuilder()
      .insert()
      .into(DailySnapshot)
      .values(entities)
      .orUpdate(
        [
          'avg_sentiment',
          'min_sentiment',
          'max_sentiment',
          'signal_count',
          'total_volume',
          'volume_weighted_sentiment',
          'updated_at',
        ],
        ['snapshot_date', 'asset_symbol'],
      )
      .execute();

    return entities.length;
  }

  async findByDate(utcDate: Date): Promise<DailySnapshot[]> {
    return this.repo.find({
      where: { snapshotDate: utcDate },
      order: { assetSymbol: 'ASC' },
    });
  }

  async findByAssetAndDateRange(
    assetSymbol: string,
    from: Date,
    to: Date,
  ): Promise<DailySnapshot[]> {
    return this.repo
      .createQueryBuilder('s')
      .where('s.asset_symbol = :assetSymbol', { assetSymbol })
      .andWhere('s.snapshot_date >= :from', { from: this.toDateString(from) })
      .andWhere('s.snapshot_date <= :to', { to: this.toDateString(to) })
      .orderBy('s.snapshot_date', 'ASC')
      .getMany();
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private toDateString(d: Date): string {
    return d.toISOString().split('T')[0]; // 'YYYY-MM-DD'
  }

  private parseRow(this: void, row: AssetAggregationRow): AssetAggregation {
    const nullableFloat = (v: string | null) =>
      v === null || v === '' ? null : parseFloat(v);

    return {
      assetSymbol: row.asset_symbol ?? null,
      avgSentiment: parseFloat(row.avg_sentiment),
      minSentiment: nullableFloat(row.min_sentiment),
      maxSentiment: nullableFloat(row.max_sentiment),
      signalCount: parseInt(row.signal_count, 10),
      totalVolume: nullableFloat(row.total_volume),
      volumeWeightedSentiment: nullableFloat(row.volume_weighted_sentiment),
    };
  }
}
