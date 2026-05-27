import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum JobRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped', // lock was held by another instance
}

@Entity('job_runs')
@Index(['jobName', 'startedAt'])
@Index(['status'])
export class JobRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Logical job name, e.g. "reconciliation", "daily-snapshot" */
  @Column({ type: 'varchar', length: 100 })
  jobName: string;

  @Column({
    type: 'enum',
    enum: JobRunStatus,
    default: JobRunStatus.RUNNING,
  })
  status: JobRunStatus;

  /** How the job was triggered: "scheduled" | "manual" */
  @Column({ type: 'varchar', length: 50, default: 'scheduled' })
  triggeredBy: string;

  /** Arbitrary result payload (counts, cursors, etc.) */
  @Column({ type: 'jsonb', nullable: true, default: null })
  result: Record<string, unknown> | null;

  /** Last error message when status = FAILED */
  @Column({ type: 'text', nullable: true, default: null })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  finishedAt: Date | null;

  /** Duration in milliseconds */
  @Column({ type: 'integer', nullable: true, default: null })
  durationMs: number | null;
}
