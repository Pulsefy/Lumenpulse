import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('crowdfund_vault_projects')
export class CrowdfundVaultProjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint', unique: true })
  @Index()
  projectId: string;

  @Column()
  contractId: string;

  @Column()
  owner: string;

  @Column({ nullable: true })
  tokenAddress: string | null;

  @Column({ default: '0' })
  totalContributions: string;

  @Column({ default: '0' })
  totalWithdrawn: string;

  @Column({ default: 0 })
  uniqueContributors: number;

  @Column({ default: 'active' })
  @Index()
  status: string;

  @Column({ type: 'bigint', nullable: true })
  refundWindowDeadline: string | null;

  @Column({ type: 'bigint', default: 0 })
  lastLedgerSeq: string;

  @Column()
  lastTxHash: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
