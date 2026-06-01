import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('crowdfund_vault_events')
@Unique('UQ_crowdfund_vault_events_tx_event', ['txHash', 'eventIndex'])
export class CrowdfundVaultEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  contractId: string;

  @Column()
  txHash: string;

  @Column()
  eventIndex: number;

  @Column()
  eventType: string;

  @Column({ type: 'bigint' })
  @Index()
  ledgerSeq: string;

  @Column({ type: 'bigint', nullable: true })
  projectId: string | null;

  @Column({ nullable: true })
  contributor: string | null;

  @Column({ nullable: true })
  amount: string | null;

  @Column({ nullable: true })
  milestoneId: number | null;

  @Column({ type: 'jsonb' })
  rawPayload: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
