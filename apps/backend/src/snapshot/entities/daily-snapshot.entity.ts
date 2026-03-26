import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Stores pre-aggregated daily sentiment and volume metrics.
 *
 * One row per (snapshot_date, asset_symbol) pair plus one global row
 * per day where asset_symbol IS NULL.
 *
 * The unique index prevents duplicate runs from producing duplicate rows —
 * the upsert in SnapshotRepository handles idempotency.
 */
@Entity('daily_snapshots')
@Index('UQ_daily_snapshots_date_asset', ['snapshotDate', 'assetSymbol'], {
  unique: true,
})
export class DailySnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** UTC calendar date this snapshot covers (time part is always 00:00:00Z). */
  @Column({ type: 'date', name: 'snapshot_date' })
  snapshotDate!: Date;

  /**
   * Asset ticker / symbol this row summarises.
   * NULL for the global (cross-asset) daily row.
   */
  @Column({ type: 'varchar', length: 20, name: 'asset_symbol', nullable: true })
  assetSymbol!: string | null;

  /** Mean sentiment score across all signals for this asset/day. */
  @Column({ type: 'numeric', precision: 10, scale: 6, name: 'avg_sentiment' })
  avgSentiment!: number;

  /** Lowest sentiment score observed during the day. */
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 6,
    name: 'min_sentiment',
    nullable: true,
  })
  minSentiment!: number | null;

  /** Highest sentiment score observed during the day. */
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 6,
    name: 'max_sentiment',
    nullable: true,
  })
  maxSentiment!: number | null;

  /** Number of raw signal rows that were aggregated. */
  @Column({ type: 'integer', name: 'signal_count' })
  signalCount!: number;

  /**
   * Total trading volume across all signals for the day.
   * NULL when volume data is unavailable in the source rows.
   */
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 4,
    name: 'total_volume',
    nullable: true,
  })
  totalVolume!: number | null;

  /**
   * Volume-weighted average sentiment: SUM(sentiment * volume) / SUM(volume).
   * NULL when volume data is unavailable.
   */
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 6,
    name: 'volume_weighted_sentiment',
    nullable: true,
  })
  volumeWeightedSentiment!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
