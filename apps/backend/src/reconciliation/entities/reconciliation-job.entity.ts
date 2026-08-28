import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export enum ReconciliationStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export type DriftSeverity = 'none' | 'warning' | 'critical';

export class DriftRecord {
  @ApiProperty({ description: 'ID of the user whose balance drifted' })
  userId: string;

  @ApiProperty({ description: 'Asset code of the drifted balance' })
  assetCode: string;

  @ApiProperty({
    description: 'Asset issuer, or null for the native asset',
    nullable: true,
  })
  assetIssuer: string | null;

  @ApiProperty({ description: 'Amount stored in the local database' })
  storedAmount: string;

  @ApiProperty({ description: 'Amount observed from the upstream source' })
  upstreamAmount: string;

  @ApiProperty({ description: 'Difference between stored and upstream amounts' })
  delta: string;

  @ApiProperty({ description: 'Whether the drift was automatically repaired' })
  repaired: boolean;

  @ApiProperty({
    description: 'Severity level of the drift',
    enum: ['none', 'warning', 'critical'],
  })
  severity: DriftSeverity;
}

@Entity('reconciliation_jobs')
@Index(['status'])
@Index(['startedAt'])
export class ReconciliationJob {
  @ApiProperty({ description: 'Reconciliation job ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: ReconciliationStatus, description: 'Job status' })
  @Column({
    type: 'enum',
    enum: ReconciliationStatus,
    default: ReconciliationStatus.RUNNING,
  })
  status: ReconciliationStatus;

  @ApiProperty({ description: 'Number of users processed by this job' })
  @Column({ type: 'int', default: 0 })
  usersProcessed: number;

  @ApiProperty({ description: 'Number of balance drifts detected' })
  @Column({ type: 'int', default: 0 })
  driftsDetected: number;

  @ApiProperty({ description: 'Number of balance drifts auto-repaired' })
  @Column({ type: 'int', default: 0 })
  driftsRepaired: number;

  @ApiProperty({
    description: 'Details of each drift detected during this job',
    type: [DriftRecord],
    nullable: true,
  })
  @Column({ type: 'jsonb', nullable: true, default: null })
  driftDetails: DriftRecord[] | null;

  @ApiProperty({
    description: 'Error message if the job failed',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true, default: null })
  errorMessage: string | null;

  @ApiProperty({ description: 'What triggered the job (e.g. scheduled, manual)' })
  @Column({ type: 'varchar', length: 50, default: 'scheduled' })
  triggeredBy: string;

  @ApiProperty({ description: 'When the job started' })
  @CreateDateColumn({ type: 'timestamptz' })
  startedAt: Date;

  @ApiProperty({ description: 'When the job finished', nullable: true })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  finishedAt: Date | null;
}
