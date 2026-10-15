import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

export enum CrowdfundVaultEventType {
  CONTRIBUTION = 'contribution',
  MILESTONE_APPROVED = 'milestone_approved',
  FUNDS_WITHDRAWN = 'funds_withdrawn',
  VAULT_CREATED = 'vault_created',
  REFUND_INITIATED = 'refund_initiated',
  REFUND_COMPLETED = 'refund_completed',
}

export enum CrowdfundVaultEventStatus {
  PENDING = 'pending',
  PROCESSED = 'processed',
  FAILED = 'failed',
  SKIPPED = 'skipped', // For duplicate/stale events
}

/**
 * Entity representing a crowdfund vault event synced from the blockchain.
 * Uses (transaction_hash, event_index) as the idempotency key.
 */
@Entity('crowdfund_vault_events')
@Unique(['transactionHash', 'eventIndex'])
@Index(['vaultAddress', 'ledgerSequence'])
@Index(['eventType', 'status'])
@Index(['processedAt'])
export class CrowdfundVaultEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'transaction_hash', type: 'varchar', length: 64 })
  transactionHash!: string;

  @Column({ name: 'event_index', type: 'int' })
  eventIndex!: number;

  @Column({ name: 'vault_address', type: 'varchar', length: 56 })
  @Index()
  vaultAddress!: string;

  @Column({ name: 'project_id', type: 'varchar', nullable: true })
  projectId?: string;

  @Column({
    name: 'event_type',
    type: 'enum',
    enum: CrowdfundVaultEventType,
  })
  eventType!: CrowdfundVaultEventType;

  @Column({ name: 'ledger_sequence', type: 'bigint' })
  ledgerSequence!: number;

  @Column({ name: 'ledger_closed_at', type: 'timestamp' })
  ledgerClosedAt!: Date;

  /**
   * Raw event payload from the Soroban event
   */
  @Column({ name: 'raw_payload', type: 'jsonb' })
  rawPayload!: Record<string, unknown>;

  /**
   * Normalized event data for efficient querying
   */
  @Column({ name: 'normalized_data', type: 'jsonb', nullable: true })
  normalizedData?: Record<string, unknown>;

  @Column({
    name: 'status',
    type: 'enum',
    enum: CrowdfundVaultEventStatus,
    default: CrowdfundVaultEventStatus.PENDING,
  })
  status!: CrowdfundVaultEventStatus;

  @Column({ name: 'processing_attempts', type: 'int', default: 0 })
  processingAttempts!: number;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage?: string;

  @Column({ name: 'last_error_stack', type: 'text', nullable: true })
  lastErrorStack?: string;

  @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
  processedAt?: Date;

  @Column({ name: 'skipped_reason', type: 'text', nullable: true })
  skippedReason?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  /**
   * For reorg detection - if a newer event in the same vault has a lower
   * ledger sequence, this may indicate a reorg.
   */
  @Column({ name: 'is_reorg_candidate', type: 'boolean', default: false })
  isReorgCandidate!: boolean;

  /**
   * The ledger sequence from the contract's internal state
   */
  @Column({ name: 'contract_ledger_sequence', type: 'bigint', nullable: true })
  contractLedgerSequence?: number;
}
