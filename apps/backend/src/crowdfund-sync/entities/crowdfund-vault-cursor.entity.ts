import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Tracks the last synced ledger for each vault contract.
 * Enables incremental sync with proper reorg handling.
 */
@Entity('crowdfund_vault_cursors')
export class CrowdfundVaultCursor {
  @PrimaryColumn({ name: 'vault_address', type: 'varchar', length: 56 })
  vaultAddress!: string;

  /**
   * The last ledger sequence that was successfully synced
   */
  @Column({ name: 'last_ledger_sequence', type: 'bigint', default: 0 })
  lastLedgerSequence!: number;

  /**
   * The block hash at the last synced ledger (for reorg detection)
   */
  @Column({
    name: 'last_ledger_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  lastLedgerHash?: string;

  /**
   * The last transaction hash processed for this vault
   */
  @Column({
    name: 'last_processed_tx_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  lastProcessedTxHash?: string;

  /**
   * Timestamp when the last sync occurred
   */
  @Column({ name: 'last_synced_at', type: 'timestamp', nullable: true })
  lastSyncedAt?: Date;

  /**
   * Number of consecutive sync failures
   */
  @Column({ name: 'consecutive_failures', type: 'int', default: 0 })
  consecutiveFailures!: number;

  /**
   * When the cursor was last updated
   */
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  /**
   * Highest ledger that has been safely processed (considering reorgs)
   */
  @Column({ name: 'safe_ledger_sequence', type: 'bigint', default: 0 })
  safeLedgerSequence!: number;
}
