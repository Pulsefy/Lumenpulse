import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { OnChainStatus } from '../dto/crowdfund.dto';

@Entity('crowdfund_projects')
export class CrowdfundProjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Unique project ID from Soroban contract */
  @Column({ type: 'varchar', length: 128, unique: true })
  @Index()
  projectId: string;

  /** Owner's Stellar address */
  @Column({ type: 'varchar', length: 128 })
  owner: string;

  /** Project name */
  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** Project description (optional) */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Banner image URL (optional) */
  @Column({ type: 'varchar', length: 512, nullable: true })
  bannerUrl: string | null;

  /** Target amount in stroops */
  @Column({ type: 'bigint' })
  targetAmount: number;

  /** Token address (Stellar asset code or contract ID) */
  @Column({ type: 'varchar', length: 128 })
  tokenAddress: string;

  /** Crowdfund vault contract address */
  @Column({ type: 'varchar', length: 128, nullable: true })
  contractAddress: string | null;

  /** Total deposited (stroops) */
  @Column({ type: 'bigint', default: 0 })
  totalDeposited: number;

  /** Total withdrawn (stroops) */
  @Column({ type: 'bigint', default: 0 })
  totalWithdrawn: number;

  /** On-chain status */
  @Column({
    type: 'enum',
    enum: OnChainStatus,
    default: OnChainStatus.ACTIVE,
  })
  onChainStatus: OnChainStatus;

  /** Last ledger sequence when this project was updated on-chain */
  @Column({ type: 'bigint', default: 0 })
  lastLedgerSeq: number;

  /** Last transaction hash that updated this project */
  @Column({ type: 'varchar', length: 128, nullable: true })
  lastTxHash: string | null;

  /** Roadmap items (stored as JSON) */
  @Column({ type: 'jsonb', default: [] })
  roadmap: Array<{
    id: string;
    title: string;
    description?: string;
    targetDate?: string;
    isCompleted: boolean;
  }>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
