import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('treasury_beneficiary_history')
@Index(['beneficiary'])
@Index(['previousBeneficiary'])
@Index(['createdAt'])
export class TreasuryBeneficiaryHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Beneficiary Stellar address (target of allocation or new beneficiary after rotation) */
  @Column({ type: 'varchar', length: 255 })
  beneficiary: string;

  /** Previous beneficiary address if rotated */
  @Column({ type: 'varchar', length: 255, nullable: true })
  previousBeneficiary: string | null;

  /** Action type: 'ALLOCATED' | 'ROTATED' | 'TERMINATED' */
  @Column({ type: 'varchar', length: 50 })
  action: string;

  /** Allocated or affected amount */
  @Column({ type: 'varchar', length: 255, nullable: true })
  amount: string | null;

  /** Blockchain transaction hash if submitted */
  @Column({ type: 'varchar', length: 255, nullable: true })
  txHash: string | null;

  /** Actor user ID who performed the action */
  @Column({ type: 'varchar', length: 255, nullable: true })
  actorId: string | null;

  /** Actor email for context */
  @Column({ type: 'varchar', length: 255, nullable: true })
  actorEmail: string | null;

  /** Additional contextual details */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;
}
