import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { CrowdfundVaultEventType } from './crowdfund-vault-event.entity';

export enum DeadLetterStatus {
  PENDING = 'pending',
  REPLAYED = 'replayed',
  RESOLVED = 'resolved',
}

export interface DeadLetterErrorEntry {
  timestamp: string;
  message: string;
  stack?: string;
}

/**
 * Entity representing a crowdfund vault event that failed processing
 * and was moved to the dead letter queue for manual inspection/replay.
 */
@Entity('crowdfund_vault_dead_letter')
@Index(['status', 'createdAt'])
@Index(['vaultAddress'])
@Index(['vaultAddress', 'eventType'])
export class CrowdfundVaultDeadLetter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'uuid', nullable: true })
  eventId?: string;

  @Column({ name: 'transaction_hash', type: 'varchar', length: 64 })
  transactionHash!: string;

  @Column({ name: 'event_index', type: 'int' })
  eventIndex!: number;

  @Column({ name: 'vault_address', type: 'varchar', length: 56 })
  vaultAddress!: string;

  @Column({ name: 'event_type', type: 'varchar' })
  eventType!: CrowdfundVaultEventType;

  @Column({ name: 'ledger_sequence', type: 'bigint' })
  ledgerSequence!: number;

  @Column({ name: 'raw_payload', type: 'jsonb' })
  rawPayload!: Record<string, unknown>;

  @Column({ name: 'failure_count', type: 'int', default: 1 })
  failureCount!: number;

  @Column({ name: 'last_error_message', type: 'text' })
  lastErrorMessage!: string;

  @Column({ name: 'last_error_stack', type: 'text', nullable: true })
  lastErrorStack?: string;

  @Column({ name: 'error_history', type: 'jsonb', default: [] })
  errorHistory!: DeadLetterErrorEntry[];

  @Column({
    name: 'status',
    type: 'enum',
    enum: DeadLetterStatus,
    default: DeadLetterStatus.PENDING,
  })
  status!: DeadLetterStatus;

  @Column({ name: 'maintainer_notes', type: 'text', nullable: true })
  maintainerNotes?: string;

  @Column({ name: 'replay_count', type: 'int', default: 0 })
  replayCount!: number;

  @Column({ name: 'last_replayed_at', type: 'timestamp', nullable: true })
  lastReplayedAt?: Date;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt?: Date;

  @Column({ name: 'resolved_by', type: 'varchar', nullable: true })
  resolvedBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
