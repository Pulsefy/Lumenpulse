import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Materialized view of the latest portfolio snapshot per user.
 *
 * One row per user — updated on every snapshot creation so that
 * summary / allocation endpoints can serve reads without recomputing
 * balances from raw events or hitting the Stellar network.
 *
 * The unique index on userId guarantees O(1) lookups for the fast-read path.
 */
@Entity('portfolio_materialized_snapshots')
@Index('UQ_materialized_user', ['userId'], { unique: true })
export class PortfolioMaterializedSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The user this materialized row belongs to. */
  @Column({ type: 'uuid' })
  userId: string;

  /** Total portfolio value in USD at the time of the source snapshot. */
  @Column({ type: 'decimal', precision: 18, scale: 2 })
  totalValueUsd: string;

  /** Pre-computed asset balances from the source snapshot. */
  @Column({ type: 'jsonb' })
  assetBalances: {
    assetCode: string;
    assetIssuer: string | null;
    amount: string;
    valueUsd: number;
  }[];

  /** Pre-computed asset allocation with percentages. */
  @Column({ type: 'jsonb', nullable: true })
  assetAllocation:
    | {
        assetCode: string;
        assetIssuer: string | null;
        amount: string;
        valueUsd: number;
        percentage: number;
      }[]
    | null;

  /** Whether the user has at least one linked Stellar account. */
  @Column({ type: 'boolean', default: false })
  hasLinkedAccount: boolean;

  /** ID of the portfolio_snapshot this row was materialized from. */
  @Column({ type: 'uuid', name: 'source_snapshot_id' })
  sourceSnapshotId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
