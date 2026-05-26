import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Tracks the last successfully ingested paging_token per account.
 * One row per watched account; updated after every successful page fetch.
 */
@Entity('horizon_ingest_checkpoints')
@Index('IDX_horizon_checkpoint_account', ['accountId'], { unique: true })
export class HorizonIngestCheckpoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The Stellar account public key being tracked. */
  @Column({ type: 'varchar', length: 64, unique: true })
  accountId: string;

  /**
   * Horizon paging_token of the last operation we successfully processed.
   * On first run this is '0' so we start from the beginning (backfill).
   */
  @Column({ type: 'varchar', length: 64, default: '0' })
  cursor: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
