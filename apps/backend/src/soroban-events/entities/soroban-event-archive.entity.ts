import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SorobanEventStatus } from './soroban-event.entity';

/**
 * Cold storage for Soroban events that have aged out of the hot partition window.
 *
 * Rows are moved here by SorobanEventArchiveService when their created_at
 * timestamp crosses the configurable retention threshold (default: 90 days).
 *
 * This table is NOT partitioned — it acts as an append-only archive.
 * Queries that need to span hot + cold data should use SorobanEventArchiveService
 * which queries both tables transparently.
 */
@Entity('soroban_events_archive')
@Index('IDX_soroban_events_archive_contract_type', [
  'contractId',
  'eventType',
  'createdAt',
])
@Index('IDX_soroban_events_archive_ledger_sequence', ['ledgerSequence'])
@Index('IDX_soroban_events_archive_archived_at', ['archivedAt'])
export class SorobanEventArchive {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  /** Original ingestion timestamp — preserved from soroban_events */
  @Column({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  /** When this row was moved to the archive */
  @CreateDateColumn({ type: 'timestamptz' })
  archivedAt: Date;
}
