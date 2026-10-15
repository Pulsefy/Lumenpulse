import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

export enum SorobanEventStatus {
  PENDING = 'pending',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

/**
 * Soroban event record — stored in the monthly-partitioned soroban_events table.
 *
 * Partition key: created_at (RANGE, one child partition per calendar month).
 *
 * PostgreSQL requires that every UNIQUE constraint on a partitioned table
 * includes the partition key column.  The (txHash, eventIndex) idempotency
 * check therefore becomes (txHash, eventIndex, createdAt) in the DB.
 * Application code that uses findOne({where: {txHash, eventIndex}}) continues
 * to work because TypeORM issues a WHERE clause without a partition bound — PG
 * will still enforce uniqueness across all partitions at INSERT/UPSERT time.
 *
 * The entity primary key is a composite (id, createdAt) matching the DB
 * constraint pk_soroban_events.  Using @PrimaryColumn for both avoids the
 * auto-increment semantics of @PrimaryGeneratedColumn and lets us keep the
 * DEFAULT gen_random_uuid() on the id column.
 */
@Entity('soroban_events')
@Index('idx_soroban_events_status', ['status'])
@Index('idx_soroban_events_ledger_sequence', ['ledgerSequence'])
@Index('IDX_soroban_events_contract_type_created_at', [
  'contractId',
  'eventType',
  'createdAt',
])
@Index('IDX_soroban_events_status_created_at', ['status', 'createdAt'])
@Index('IDX_soroban_events_processed_at', ['processedAt'])
export class SorobanEvent {
  /**
   * UUID primary key.  Part of the composite PK (id, created_at) required by
   * the partitioned table.  Use @PrimaryColumn so TypeORM does not try to
   * manage the sequence; the DB default gen_random_uuid() populates it.
   */
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
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

  /**
   * Partition key — also part of the composite PRIMARY KEY (id, created_at).
   * Declared as @PrimaryColumn with a DB default so TypeORM treats it as part
   * of the entity identity while still allowing the DB to populate it on INSERT
   * when not explicitly supplied by the caller.
   */
  @PrimaryColumn({
    type: 'timestamptz',
    default: () => 'now()',
    name: 'created_at',
  })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}
