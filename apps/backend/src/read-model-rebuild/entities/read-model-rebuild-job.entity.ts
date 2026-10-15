import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum RebuildStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum RebuildDataset {
  KPI_SNAPSHOTS = 'kpi_snapshots',
  PROJECT_VIEWS = 'project_views',
  CONTRACT_EVENTS = 'contract_events',
  DAILY_METRICS = 'daily_metrics',
  ALL = 'all',
}

@Entity('read_model_rebuild_jobs')
@Index(['status', 'createdAt'])
@Index(['dataset', 'status'])
@Index(['contractId', 'status'])
export class ReadModelRebuildJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: RebuildDataset,
    nullable: false,
  })
  dataset: RebuildDataset;

  @Column({ type: 'varchar', nullable: true, length: 255 })
  contractId: string | null;

  @Column({
    type: 'enum',
    enum: RebuildStatus,
    default: RebuildStatus.PENDING,
  })
  status: RebuildStatus;

  @Column({ type: 'text', nullable: true })
  triggerReason: string | null;

  @Column({ type: 'varchar', nullable: true, length: 255 })
  triggeredBy: string | null;

  @Column({ type: 'int', default: 0 })
  totalItems: number;

  @Column({ type: 'int', default: 0 })
  processedItems: number;

  @Column({ type: 'int', default: 0 })
  failedItems: number;

  @Column({ type: 'jsonb', nullable: true })
  progressDetails: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'jsonb', nullable: true })
  errorStack: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;

  // For idempotency - prevent duplicate rebuilds for same dataset/contract
  @Column({ type: 'varchar', nullable: true, length: 255 })
  idempotencyKey: string | null;

  // Track which version of the rebuild logic was used
  @Column({ type: 'varchar', nullable: true, length: 50 })
  rebuildVersion: string | null;
}
