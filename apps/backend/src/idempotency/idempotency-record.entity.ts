import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum IdempotencyRecordStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}

/**
 * A claimed `Idempotency-Key` for a write endpoint.
 *
 * One row per (key, method, route). The unique index is what serialises
 * concurrent requests carrying the same key: the first INSERT wins, and every
 * other request either replays the stored response (completed) or waits for it
 * (in_progress).
 *
 * `requestHash` pins a key to a single payload, so reusing a key with a
 * different body is rejected rather than silently returning a stale response.
 * `leaseExpiresAt` lets a retry reclaim a claim whose owner crashed mid-flight.
 * `expiresAt` is the retention window; an expired row is dropped by the
 * scheduled cleanup job.
 */
@Entity('idempotency_records')
@Index('IDX_idempotency_key_method_route', ['key', 'method', 'route'], {
  unique: true,
})
@Index('IDX_idempotency_expires_at', ['expiresAt'])
@Index('IDX_idempotency_status_lease', ['status', 'leaseExpiresAt'])
export class IdempotencyRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The client-supplied `Idempotency-Key` header value. */
  @Column({ type: 'varchar', length: 128 })
  key: string;

  @Column({ type: 'varchar', length: 16 })
  method: string;

  /** The URL path (query string excluded) the key was used on. */
  @Column({ type: 'varchar', length: 512 })
  route: string;

  /** sha256 of method + route + request body. */
  @Column({ type: 'varchar', length: 64 })
  requestHash: string;

  @Column({
    type: 'enum',
    enum: IdempotencyRecordStatus,
    default: IdempotencyRecordStatus.IN_PROGRESS,
  })
  status: IdempotencyRecordStatus;

  @Column({ type: 'integer', nullable: true })
  responseStatus: number | null;

  /** The JSON body of the original response, returned verbatim on replay. */
  @Column({ type: 'jsonb', nullable: true })
  responseBody: unknown;

  /**
   * Deadline for an in_progress claim. Past this, another request may delete
   * the row and take over, so a crashed worker never wedges the key.
   */
  @Column({ type: 'timestamptz' })
  leaseExpiresAt: Date;

  /** When this record is no longer replayed and may be cleaned up. */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
