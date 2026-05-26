import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Persisted record of a single Stellar account operation fetched from Horizon.
 * `operationId` is the Horizon-assigned numeric ID and serves as the dedup key.
 */
@Entity('horizon_account_operations')
@Index('IDX_horizon_ops_account_created', ['accountId', 'createdAt'])
@Index('IDX_horizon_ops_type', ['type'])
export class AccountOperation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Horizon operation ID — globally unique, used for deduplication. */
  @Column({ type: 'varchar', length: 64, unique: true })
  operationId: string;

  /** The Stellar account public key this operation belongs to. */
  @Column({ type: 'varchar', length: 64 })
  accountId: string;

  /** Horizon operation type, e.g. "payment", "create_account", "change_trust". */
  @Column({ type: 'varchar', length: 64 })
  type: string;

  /** Horizon paging token — used to resume incremental ingestion. */
  @Column({ type: 'varchar', length: 64 })
  pagingToken: string;

  /** Ledger close time reported by Horizon. */
  @Column({ type: 'timestamptz' })
  createdAt: Date;

  /** Full operation record as returned by Horizon, stored for flexibility. */
  @Column({ type: 'jsonb' })
  raw: Record<string, unknown>;

  /** When this row was inserted into our database. */
  @CreateDateColumn({ type: 'timestamptz' })
  ingestedAt: Date;
}
