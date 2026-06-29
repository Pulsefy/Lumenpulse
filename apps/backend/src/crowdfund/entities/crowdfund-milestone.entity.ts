import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('crowdfund_milestones')
@Index(['projectId'])
export class CrowdfundMilestoneEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Foreign key to crowdfund_projects.projectId */
  @Column({ type: 'varchar', length: 128 })
  @Index()
  projectId: string;

  /** Milestone ID from contract */
  @Column({ type: 'varchar', length: 128 })
  milestoneId: string;

  /** Milestone title */
  @Column({ type: 'varchar', length: 255 })
  title: string;

  /** Milestone description (optional) */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Target date for milestone (optional) */
  @Column({ type: 'timestamptz', nullable: true })
  targetDate: Date | null;

  /** Whether the milestone is approved/completed */
  @Column({ type: 'boolean', default: false })
  isCompleted: boolean;

  /** Ledger sequence when milestone was approved (if applicable) */
  @Column({ type: 'bigint', nullable: true })
  approvedLedgerSeq: number | null;

  /** Transaction hash of approval (if applicable) */
  @Column({ type: 'varchar', length: 128, nullable: true })
  approvedTxHash: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
