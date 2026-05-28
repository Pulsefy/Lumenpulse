import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('vault_deposit_events')
export class VaultDepositEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Soroban event ID — globally unique, used for idempotency */
  @Column({ unique: true })
  eventId: string;

  @Column()
  contractId: string;

  @Column()
  ledger: number;

  @Column({ type: 'timestamptz' })
  ledgerAt: Date;

  @Index()
  @Column()
  projectId: string; // stored as string to avoid JS bigint precision loss

  @Column()
  userAddress: string;

  @Column({ type: 'numeric', precision: 38, scale: 0 })
  amount: string; // i128 as string

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
