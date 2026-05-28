import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('vault_milestone_events')
export class VaultMilestoneEvent {
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
  projectId: string;

  @Column()
  milestoneId: number;

  /** Set for admin-approved milestones; null for vote-approved */
  @Column({ nullable: true })
  approvedBy: string | null;

  /** true = approved via contributor vote, false = admin approval */
  @Column({ default: false })
  viaVote: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
