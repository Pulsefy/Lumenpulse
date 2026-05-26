import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Pre-aggregated daily reputation snapshot for a single contributor.
 *
 * One row per (snapshot_date, contributor_address). The unique index
 * makes the upsert idempotent — re-running the nightly job for the same
 * date updates existing rows rather than inserting duplicates.
 */
@Entity('contributor_snapshots')
@Index('UQ_contributor_snapshots_date_addr', ['snapshotDate', 'contributorAddress'], {
  unique: true,
})
@Index(['snapshotDate'])
@Index(['reputationScore'])
export class ContributorSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** UTC calendar date this snapshot covers (time part is always 00:00:00Z). */
  @Column({ type: 'date', name: 'snapshot_date' })
  snapshotDate!: Date;

  /** Stellar account address of the contributor. */
  @Column({ type: 'varchar', length: 64, name: 'contributor_address' })
  contributorAddress!: string;

  /** GitHub handle at the time of snapshot (may change over time). */
  @Column({ type: 'varchar', length: 255, name: 'github_handle', nullable: true })
  githubHandle!: string | null;

  /** Reputation score read from the testnet contributor_registry contract. */
  @Column({ type: 'bigint', name: 'reputation_score', default: 0 })
  reputationScore!: number;

  /** Rank within this snapshot date (1 = highest score). Computed at write time. */
  @Column({ type: 'integer', name: 'rank', nullable: true })
  rank!: number | null;

  /** Ledger timestamp when the on-chain data was last updated. */
  @Column({ type: 'bigint', name: 'registered_timestamp', nullable: true })
  registeredTimestamp!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
