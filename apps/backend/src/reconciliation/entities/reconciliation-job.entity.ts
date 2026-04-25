import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum ReconciliationStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface DriftRecord {
  userId: string;
  assetCode: string;
  assetIssuer: string | null;
  storedAmount: string;
  upstreamAmount: string;
  delta: string;
  repaired: boolean;
}

@Entity('reconciliation_jobs')
@Index(['status'])
@Index(['startedAt'])
export class ReconciliationJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: ReconciliationStatus,
    default: ReconciliationStatus.RUNNING,
  })
  status: ReconciliationStatus;

  @Column({ type: 'int', default: 0 })
  usersProcessed: number;

  @Column({ type: 'int', default: 0 })
  driftsDetected: number;

  @Column({ type: 'int', default: 0 })
  driftsRepaired: number;

  @Column({ type: 'jsonb', nullable: true, default: null })
  driftDetails: DriftRecord[] | null;

  @Column({ type: 'text', nullable: true, default: null })
  errorMessage: string | null;

  @Column({ type: 'varchar', length: 50, default: 'scheduled' })
  triggeredBy: string;

  @CreateDateColumn({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  finishedAt: Date | null;
}
