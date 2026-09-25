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
      -- Calculate on-chain KPIs
      WITH on_chain_kpis AS (
        SELECT
          -- Count active rounds: created but not yet finalized
          (SELECT COUNT(*)
           FROM soroban_events
           WHERE event_type = 'RoundCreatedEvent'
             AND DATE(created_at AT TIME ZONE 'UTC') <= $1)
          -
          (SELECT COUNT(*)
           FROM soroban_events
           WHERE event_type = 'RoundFinalizedEvent'
             AND DATE(created_at AT TIME ZONE 'UTC') <= $1)
          AS active_rounds,
          -- Count contribution count for the day
          (SELECT COUNT(*)
           FROM soroban_events
           WHERE event_type IN ('ContributionRecordedEvent', 'DepositEvent')
             AND DATE(created_at AT TIME ZONE 'UTC') = $1)
          AS contribution_count,
          -- Total contribution amount for the day
          (SELECT SUM(
            COALESCE(
              (raw_payload->>'amount')::numeric,
              (raw_payload->>'value')::numeric,
              0
            )
          )
           FROM soroban_events
           WHERE event_type IN ('ContributionRecordedEvent', 'DepositEvent')
             AND DATE(created_at AT TIME ZONE 'UTC') = $1)
          AS total_contribution_amount,
          -- TVL: total deposits minus total withdrawals up to this date
          (SELECT
            COALESCE(SUM(
              CASE
                WHEN event_type IN ('ContributionRecordedEvent', 'DepositEvent', 'PoolFundedEvent')
                THEN COALESCE((raw_payload->>'amount')::numeric, (raw_payload->>'value')::numeric, 0)
                WHEN event_type IN ('WithdrawEvent', 'ContributionRefundedEvent', 'ContributionPaidOutEvent', 'ContributionClawedBackEvent', 'MatchDistributedEvent')
                THEN -COALESCE((raw_payload->>'amount')::numeric, (raw_payload->>'value')::numeric, 0)
                ELSE 0
              END
            ), 0)
           FROM soroban_events
           WHERE DATE(created_at AT TIME ZONE 'UTC') <= $1)
          AS tvl
      ),

      -- Per-asset sentiment data
      per_asset_sentiment AS (
        SELECT
          asset_symbol,
          AVG(sentiment_score)::text AS avg_sentiment,
          MIN(sentiment_score)::text AS min_sentiment,
          MAX(sentiment_score)::text AS max_sentiment,
          COUNT(*)::text AS signal_count,
          SUM(volume)::text AS total_volume,
          CASE
            WHEN SUM(volume) > 0
            THEN (SUM(sentiment_score * volume) / SUM(volume))::text
            ELSE NULL
          END AS volume_weighted_sentiment
        FROM sentiment_signals
        WHERE DATE(signal_timestamp AT TIME ZONE 'UTC') = $1
          AND asset_symbol IS NOT NULL
        GROUP BY asset_symbol
      ),

      -- Global sentiment data
      global_sentiment AS (
        SELECT
          NULL AS asset_symbol,
          AVG(sentiment_score)::text AS avg_sentiment,
          MIN(sentiment_score)::text AS min_sentiment,
          MAX(sentiment_score)::text AS max_sentiment,
          COUNT(*)::text AS signal_count,
          SUM(volume)::text AS total_volume,
          CASE
            WHEN SUM(volume) > 0
            THEN (SUM(sentiment_score * volume) / SUM(volume))::text
            ELSE NULL
          END AS volume_weighted_sentiment
        FROM sentiment_signals
        WHERE DATE(signal_timestamp AT TIME ZONE 'UTC') = $1
      )

      -- Combine per-asset + on-chain
      SELECT
        pas.asset_symbol,
        pas.avg_sentiment,
        pas.min_sentiment,
        pas.max_sentiment,
        pas.signal_count,
        pas.total_volume,
        pas.volume_weighted_sentiment,
        ock.tvl::text AS tvl,
        NULL::text AS active_rounds, -- active_rounds is only for global
        NULL::text AS contribution_count,
        NULL::text AS total_contribution_amount
      FROM per_asset_sentiment pas, on_chain_kpis ock

      UNION ALL

      -- Combine global + on-chain (always return a row even without sentiment data
      SELECT
        NULL::text AS asset_symbol,
        COALESCE(gs.avg_sentiment, '0') AS avg_sentiment,
        COALESCE(gs.min_sentiment, NULL) AS min_sentiment,
        COALESCE(gs.max_sentiment, NULL) AS max_sentiment,
        COALESCE(gs.signal_count, '0') AS signal_count,
        gs.total_volume,
        gs.volume_weighted_sentiment,
        ock.tvl::text AS tvl,
        ock.active_rounds::text AS active_rounds,
        ock.contribution_count::text AS contribution_count,
        ock.total_contribution_amount::text AS total_contribution_amount
      FROM on_chain_kpis ock
      LEFT JOIN global_sentiment gs ON true
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
      tvl: agg.tvl,
      activeRounds: agg.activeRounds,
      contributionCount: agg.contributionCount,
      totalContributionAmount: agg.totalContributionAmount,
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
          'tvl',
          'active_rounds',
          'contribution_count',
          'total_contribution_amount',
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

    const nullableInt = (v: string | null) =>
      v === null || v === '' ? null : parseInt(v, 10);

    return {
      assetSymbol: row.asset_symbol ?? null,
      avgSentiment: parseFloat(row.avg_sentiment),
      minSentiment: nullableFloat(row.min_sentiment),
      maxSentiment: nullableFloat(row.max_sentiment),
      signalCount: parseInt(row.signal_count, 10),
      totalVolume: nullableFloat(row.total_volume),
      volumeWeightedSentiment: nullableFloat(row.volume_weighted_sentiment),
      tvl: nullableFloat(row.tvl),
      activeRounds: nullableInt(row.active_rounds),
      contributionCount: nullableInt(row.contribution_count),
      totalContributionAmount: nullableFloat(row.total_contribution_amount),
    };
  }
}
