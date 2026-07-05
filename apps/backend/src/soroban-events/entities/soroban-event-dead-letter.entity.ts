import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SorobanEvent } from './soroban-event.entity';

export enum DeadLetterStatus {
  PENDING = 'pending',
  RESOLVED = 'resolved',
  REPLAYED = 'replayed',
}

/**
 * Dead Letter Queue for failed Soroban event processing
 * Stores events that have exhausted all retry attempts
 * Allows maintainers to inspect, debug, and replay events safely
 */
@Entity('soroban_event_dead_letter')
@Index(['status'])
@Index(['createdAt'])
@Index(['txHash', 'eventIndex'], { unique: true })
@Index(['status', 'createdAt']) // For efficient filtering/sorting
@Index(['sorobanEventId'])
@Index('IDX_dlq_unresolved', ['status'], {
  where: '"status" != \'resolved\'',
})
export class SorobanEventDeadLetter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Link to original SorobanEvent */
  @Column({ type: 'uuid', nullable: true })
  sorobanEventId: string | null;

  @ManyToOne(() => SorobanEvent, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'soroban_event_id' })
  sorobanEvent?: SorobanEvent;

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

  /**
   * Number of failed processing attempts
   * Incremented each time processing fails
   */
  @Column({ type: 'integer', default: 0 })
  failureCount: number;

  /**
   * The last error message from processing attempt
   * Preserved for debugging
   */
  @Column({ type: 'text', nullable: true })
  lastErrorMessage: string | null;

  /**
   * Stack trace of the last error for detailed debugging
   */
  @Column({ type: 'text', nullable: true })
  lastErrorStack: string | null;

  /**
   * Timestamp of the last processing attempt
   */
  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptAt: Date | null;

  /**
   * Array of error history for tracking patterns
   * Each entry: { timestamp, message, stack }
   */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  errorHistory: Array<{
    timestamp: string;
    message: string;
    stack?: string;
  }>;

  /**
   * Current status of the DLQ entry
   * - pending: Awaiting replay or manual intervention
   * - replayed: Successfully replayed from dead letter
   * - resolved: Marked as resolved (no further action needed)
   */
  @Column({
    type: 'enum',
    enum: DeadLetterStatus,
    default: DeadLetterStatus.PENDING,
  })
  status: DeadLetterStatus;

  /**
   * Notes added by maintainer for context
   */
  @Column({ type: 'text', nullable: true })
  maintainerNotes: string | null;

  /**
   * Number of replay attempts from dead letter
   * Prevents infinite replay loops
   */
  @Column({ type: 'integer', default: 0 })
  replayCount: number;

  /**
   * Timestamp of last successful replay (if any)
   */
  @Column({ type: 'timestamptz', nullable: true })
  lastReplayedAt: Date | null;

  /**
   * Timestamp when marked as resolved
   */
  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  /**
   * User/service that initiated resolution
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  resolvedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz' })
  updatedAt: Date;
}
