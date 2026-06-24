import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { DriftSeverity, DriftRecord } from '../interfaces/drift.types';

@Entity('drift_reports')
@Index(['triggeredBy'])
@Index(['startedAt'])
@Index(['status'])
export class DriftReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'varchar',
    length: 50,
    default: 'scheduled',
  })
  triggeredBy: string;

  @Column({
    type: 'enum',
    enum: ['running', 'completed', 'failed'],
    default: 'running',
  })
  status: 'running' | 'completed' | 'failed';

  @Column({ type: 'int', default: 0 })
  totalScanned: number;

  @Column({ type: 'int', default: 0 })
  totalDrifts: number;

  @Column({ type: 'int', default: 0 })
  criticalCount: number;

  @Column({ type: 'int', default: 0 })
  highCount: number;

  @Column({ type: 'int', default: 0 })
  mediumCount: number;

  @Column({ type: 'int', default: 0 })
  lowCount: number;

  @Column({ type: 'jsonb', nullable: true, default: null })
  drifts: DriftRecord[] | null;

  @Column({ type: 'jsonb', nullable: true, default: null })
  summary: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true, default: null })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  finishedAt: Date | null;

  @Column({ type: 'integer', nullable: true, default: null })
  durationMs: number | null;
}
