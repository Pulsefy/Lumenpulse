import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum SorobanEventStatus {
  PENDING = 'pending',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

@Entity('soroban_events')
@Index(['txHash', 'eventIndex'], { unique: true })
@Index(['status'])
@Index('IDX_soroban_events_contract_type_created_at', [
  'contractId',
  'eventType',
  'createdAt',
])
@Index('IDX_soroban_events_status_created_at', ['status', 'createdAt'])
@Index('IDX_soroban_events_processed_at', ['processedAt'])
@Index('IDX_soroban_events_ledger_sequence', ['ledgerSequence'])
export class SorobanEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Idempotency key: transaction hash */
  @Column({ type: 'varchar', length: 128 })
  txHash: string;

  /** Idempotency key: position of the event within the transaction */
  @Column({ type: 'integer' })
  eventIndex: number;

  /** Soroban contract address that emitted the event */
  @Column({ type: 'varchar', length: 128, nullable: true })
  contractId: string | null;

  /** Event type / topic, e.g. "transfer", "mint" */
  @Column({ type: 'varchar', length: 128, nullable: true })
  eventType: string | null;

  /** Canonical event type from unified taxonomy */
  @Column({ type: 'varchar', length: 64, nullable: true })
  canonicalType: string | null;

  /** High-level event category */
  @Column({ type: 'varchar', length: 32, nullable: true })
  category: string | null;

  /** Full raw payload stored for audit/debug */
  @Column({ type: 'jsonb' })
  rawPayload: Record<string, unknown>;

  /** Ledger sequence number where this event was emitted */
  @Column({ type: 'bigint', nullable: true })
  ledgerSequence: number | null;

  @Column({
    type: 'enum',
    enum: SorobanEventStatus,
    default: SorobanEventStatus.PENDING,
  })
  status: SorobanEventStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}
