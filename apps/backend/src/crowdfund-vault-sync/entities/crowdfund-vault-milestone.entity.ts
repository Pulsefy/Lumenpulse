import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('crowdfund_vault_milestones')
@Unique('UQ_crowdfund_vault_milestones_project_milestone', [
  'projectId',
  'milestoneId',
])
export class CrowdfundVaultMilestoneEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint' })
  @Index()
  projectId: string;

  @Column()
  milestoneId: number;

  @Column({ default: 'pending' })
  status: string;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'bigint', nullable: true })
  lastLedgerSeq: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
