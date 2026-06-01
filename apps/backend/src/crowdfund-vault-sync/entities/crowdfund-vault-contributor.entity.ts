import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('crowdfund_vault_contributors')
@Unique('UQ_crowdfund_vault_contributors_project_contributor', [
  'projectId',
  'contributor',
])
export class CrowdfundVaultContributorEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint' })
  @Index()
  projectId: string;

  @Column()
  contributor: string;

  @Column({ default: '0' })
  totalContributed: string;

  @Column({ type: 'bigint', nullable: true })
  firstContributionLedger: string | null;

  @Column({ type: 'bigint', nullable: true })
  lastContributionLedger: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
