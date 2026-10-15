import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { SorobanEventStatus } from './soroban-event.entity';

/**
 * Maps to soroban_events_archive — the cold-storage table that receives rows
 * older than the hot window (SOROBAN_HOT_WINDOW_DAYS, default 90 days).
 *
 * The schema is intentionally identical to SorobanEvent so that rows can be
 * moved with a plain INSERT INTO … SELECT without any transformation.
 *
 * This entity is used by:
 *   - SorobanEventsRetentionService  — to INSERT archived rows
 *   - SorobanEventsService           — for cross-boundary reads (via the
 *     soroban_events_all VIEW or directly from this table)
 */
@Entity('soroban_events_archive')
@Index('idx_soroban_events_archive_status', ['status'])
@Index('idx_soroban_events_archive_ledger', ['ledgerSequence'])
@Index('idx_soroban_events_archive_contract', [
  'contractId',
  'eventType',
  'createdAt',
])
export class SorobanEventArchive {
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  id: string;

  @Column({ type: 'varchar', length: 128, name: 'tx_hash' })
  txHash: string;

  @Column({ type: 'integer', name: 'event_index' })
  eventIndex: number;

  @Column({ type: 'varchar', length: 128, nullable: true, name: 'contract_id' })
  contractId: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, name: 'event_type' })
  eventType: string | null;

  @Column({
    type: 'varchar',
    length: 64,
    nullable: true,
    name: 'canonical_type',
  })
  canonicalType: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'category' })
  category: string | null;

  @Column({ type: 'jsonb', name: 'raw_payload' })
  rawPayload: Record<string, unknown>;

  @Column({ type: 'bigint', nullable: true, name: 'ledger_sequence' })
  ledgerSequence: number | null;

  @Column({
    type: 'enum',
    enum: SorobanEventStatus,
    default: SorobanEventStatus.PENDING,
    name: 'status',
  })
  status: SorobanEventStatus;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @PrimaryColumn({
    type: 'timestamptz',
    default: () => 'now()',
    name: 'created_at',
  })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'processed_at' })
  processedAt: Date | null;
}
