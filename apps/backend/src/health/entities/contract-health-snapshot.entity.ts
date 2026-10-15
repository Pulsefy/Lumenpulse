import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  ContractHealthResult,
  ContractHealthSummary,
} from '../contract-health.service';

/**
 * Persists a point-in-time copy of the contract health report produced by
 * ContractHealthService.  One row per capture event.
 *
 * The full `contracts` array is stored as JSONB so that the schema is never a
 * barrier to evolving the health check logic — the controller can return the
 * raw payload without extra mapping.
 *
 * Index strategy:
 *   - capturedAt DESC  → fast "latest N" queries
 *   - network          → filter by environment without a full scan
 */
@Entity('contract_health_snapshots')
@Index('IDX_chs_captured_at', ['capturedAt'])
@Index('IDX_chs_network', ['network'])
export class ContractHealthSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** UTC timestamp when this snapshot was captured. */
  @Column({ type: 'timestamptz', name: 'captured_at' })
  capturedAt!: Date;

  /** Stellar network at the time of capture ('testnet' | 'mainnet'). */
  @Column({ type: 'varchar', length: 20 })
  network!: string;

  /** Top-level status: 'ok' when all contracts reachable, 'error' otherwise. */
  @Column({ type: 'varchar', length: 20, name: 'overall_status' })
  overallStatus!: string;

  /**
   * Aggregate counts: { total, reachable, misconfigured, unreachable }.
   * Stored denormalised so diff queries don't need to traverse the contracts
   * array in application code.
   */
  @Column({ type: 'jsonb' })
  summary!: ContractHealthSummary;

  /**
   * Full per-contract check results as returned by ContractHealthService.
   * Typed at the TS layer; stored as an opaque JSONB blob in Postgres.
   */
  @Column({ type: 'jsonb' })
  contracts!: ContractHealthResult[];

  /**
   * Optional label describing what triggered the capture.
   * 'scheduler'  — automatic 30-minute cron
   * 'manual'     — ad-hoc API call
   */
  @Column({
    type: 'varchar',
    length: 50,
    name: 'triggered_by',
    default: 'scheduler',
  })
  triggeredBy!: string;

  /** Row insertion time — handled by TypeORM. */
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
