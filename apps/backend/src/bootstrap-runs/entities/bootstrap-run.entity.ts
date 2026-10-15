import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * What produced a bootstrap run.
 *
 * `demo_seed`       — DemoBootstrapService seeded in-memory demo scenarios.
 * `testnet_account` — TestnetBootstrapService funded an account via Friendbot.
 */
export const BootstrapRunKind = {
  DEMO_SEED: 'demo_seed',
  TESTNET_ACCOUNT: 'testnet_account',
} as const;

export type BootstrapRunKind =
  (typeof BootstrapRunKind)[keyof typeof BootstrapRunKind];

export const BootstrapRunStatus = {
  ACTIVE: 'active',
  TORN_DOWN: 'torn_down',
} as const;

export type BootstrapRunStatus =
  (typeof BootstrapRunStatus)[keyof typeof BootstrapRunStatus];

/**
 * The kinds of resource a bootstrap run can create. Each type maps to a
 * teardown handler in BootstrapTeardownService.
 */
export const BootstrapResourceType = {
  DEMO_CONTRIBUTOR: 'demo_contributor',
  DEMO_GRANT_ROUND: 'demo_grant_round',
  TESTNET_ACCOUNT: 'testnet_account',
} as const;

export type BootstrapResourceType =
  (typeof BootstrapResourceType)[keyof typeof BootstrapResourceType];

/**
 * One resource created by a bootstrap run. `identifier` is whatever uniquely
 * addresses the resource within its type — a Stellar public key for accounts,
 * the seeded contributor address, or the grant round id.
 */
export interface BootstrapResourceRecord {
  type: BootstrapResourceType;
  identifier: string;
  label: string;
}

/**
 * Records a single bootstrap run so it can later be torn down by identifier.
 *
 * Runs are append-only: teardown flips `status` to `torn_down` and stores the
 * per-resource outcome in `teardownSummary` rather than deleting the row, so a
 * contributor can always see what a given environment was reset from.
 */
@Entity('bootstrap_runs')
@Index('IDX_bootstrap_runs_created_at', ['createdAt'])
@Index('IDX_bootstrap_runs_kind_status', ['kind', 'status'])
export class BootstrapRun {
  /** The run identifier callers pass to the teardown endpoint. */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  kind!: BootstrapRunKind;

  @Column({ type: 'varchar', length: 20, default: BootstrapRunStatus.ACTIVE })
  status!: BootstrapRunStatus;

  /** Stellar network the run targeted ('testnet' | 'mainnet'). */
  @Column({ type: 'varchar', length: 20 })
  network!: string;

  /** NODE_ENV at the time of the run — part of the teardown safety gate. */
  @Column({ type: 'varchar', length: 32 })
  environment!: string;

  /** Everything the run created, in teardown order. */
  @Column({ type: 'jsonb' })
  resources!: BootstrapResourceRecord[];

  /** Admin user id that triggered the run, when the caller was authenticated. */
  @Column({ type: 'varchar', length: 64, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'torn_down_at', nullable: true })
  tornDownAt!: Date | null;

  @Column({ type: 'varchar', length: 64, name: 'torn_down_by', nullable: true })
  tornDownBy!: string | null;

  /**
   * Per-resource teardown outcome, stored so a completed teardown stays
   * auditable after the underlying state is gone.
   */
  @Column({ type: 'jsonb', name: 'teardown_summary', nullable: true })
  teardownSummary!: Record<string, unknown> | null;
}
