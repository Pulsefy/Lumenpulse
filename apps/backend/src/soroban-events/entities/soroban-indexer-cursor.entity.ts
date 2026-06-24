import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Tracks the last successfully indexed ledger sequence per cursor key.
 * A cursor key is typically a contract ID or the special value "__global__"
 * for a network-wide sweep.
 */
@Entity('soroban_indexer_cursors')
export class SorobanIndexerCursor {
  /** Cursor key — contract ID or "__global__" */
  @PrimaryColumn({ type: 'varchar', length: 128 })
  cursorKey: string;

  /** Last ledger sequence that was fully indexed */
  @Column({ type: 'bigint' })
  lastLedgerSequence: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
