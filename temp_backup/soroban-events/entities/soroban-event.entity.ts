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

  /** Full raw payload stored for audit/debug */
  @Column({ type: 'jsonb' })
  rawPayload: Record<string, unknown>;

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
