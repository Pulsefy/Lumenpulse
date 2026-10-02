import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SorobanEventStatus } from './soroban-event.entity';

/**
 * Cold storage for `soroban_events` rows that aged out of the hot window.
 * Schema mirrors the hot table so replay/backfill can union both sides.
 *
 * The unique `(txHash, eventIndex)` constraint is the cross-boundary
 * idempotency key: archival is `INSERT ... ON CONFLICT DO NOTHING`, and
 * writers check this table before inserting into the hot table.
 */
@Entity('soroban_events_archive')
@Index('IDX_soroban_events_archive_original_id', ['originalId'])
@Index('IDX_soroban_events_archive_ledger', ['ledgerSequence'])
@Index('IDX_soroban_events_archive_contract_type_created', [
  'contractId',
  'eventType',
  'createdAt',
])
@Index('IDX_soroban_events_archive_archived_at', ['archivedAt'])
export class SorobanEventArchive {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Primary key of the row in `soroban_events` before it was archived. */
  @Column({ type: 'uuid' })
  originalId: string;

  @Column({ type: 'varchar', length: 128 })
  txHash: string;

  @Column({ type: 'integer' })
  eventIndex: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  contractId: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  eventType: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  canonicalType: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  category: string | null;

  @Column({ type: 'jsonb' })
  rawPayload: Record<string, unknown>;

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

  @Column({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  archivedAt: Date;
}
