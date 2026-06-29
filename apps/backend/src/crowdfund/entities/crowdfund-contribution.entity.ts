import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('crowdfund_contributions')
@Index(['projectId', 'contributor'])
@Index(['txHash'])
export class CrowdfundContributionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Foreign key to crowdfund_projects.projectId */
  @Column({ type: 'varchar', length: 128 })
  @Index()
  projectId: string;

  /** Contributor's Stellar address */
  @Column({ type: 'varchar', length: 128 })
  contributor: string;

  /** Amount in stroops */
  @Column({ type: 'bigint' })
  amount: number;

  /** Transaction hash */
  @Column({ type: 'varchar', length: 128 })
  txHash: string;

  /** Ledger sequence when the contribution was made */
  @Column({ type: 'bigint' })
  ledgerSequence: number;

  /** Timestamp from the ledger */
  @Column({ type: 'timestamptz', nullable: true })
  ledgerTimestamp: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
