import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

export enum PortfolioAnomalyStatus {
  UNRESOLVED = 'unresolved',
  ACKNOWLEDGED = 'acknowledged',
}

export enum PortfolioAnomalySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

@Entity('portfolio_anomalies')
@Index(['userId', 'createdAt'])
@Index(['status'])
export class PortfolioAnomaly {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 100 })
  anomalyType: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: PortfolioAnomalySeverity.MEDIUM,
  })
  severity: PortfolioAnomalySeverity | string;

  @Column({
    type: 'varchar',
    length: 20,
    default: PortfolioAnomalyStatus.UNRESOLVED,
  })
  status: PortfolioAnomalyStatus | string;

  @Column({ type: 'uuid', nullable: true })
  reviewerId: string | null;

  @Column({ type: 'text', nullable: true })
  reviewerNotes: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewerNotesUpdatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @VersionColumn({ default: 1 })
  version: number;
}
