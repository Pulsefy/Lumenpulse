import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Stores audit records for all blockchain-triggered admin actions.
 * Tracks who executed what, against which contract, with what parameters,
 * and captures the resulting transaction hash for on-chain verification.
 */
@Entity('blockchain_audit_logs')
export class BlockchainAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Admin actor who triggered the action (user ID).
   */
  @Column({ name: 'actor_id', type: 'uuid' })
  @Index()
  actorId: string;

  /**
   * Email or display name of the actor (denormalized for auditability).
   */
  @Column({ name: 'actor_display', type: 'varchar', length: 255 })
  @Index()
  actorDisplay: string;

  /**
   * Admin endpoint that was called (e.g., "POST /admin/matching-pool/rounds").
   */
  @Column({ name: 'endpoint', type: 'varchar', length: 255 })
  @Index()
  endpoint: string;

  /**
   * HTTP method (POST, PUT, PATCH, DELETE, etc.).
   */
  @Column({ name: 'http_method', type: 'varchar', length: 10 })
  httpMethod: string;

  /**
   * Target Soroban contract identifier
   * (e.g., matching_pool, treasury, registry).
   */
  @Column({ name: 'target_contract', type: 'varchar', length: 100 })
  @Index()
  targetContract: string;

  /**
   * Soroban contract function name
   * (e.g., "create_round", "approve_project", "allocate_budget").
   */
  @Column({ name: 'function_name', type: 'varchar', length: 100 })
  functionName: string;

  /**
   * Public stellar contract address for verification.
   */
  @Column({ name: 'contract_address', type: 'varchar', length: 255 })
  contractAddress: string;

  /**
   * Sanitized summary of parameters passed (sensitive fields redacted).
   * Stored as JSON for flexible querying.
   */
  @Column({ name: 'params_summary', type: 'jsonb', nullable: true })
  paramsSummary: Record<string, any> | null;

  /**
   * Result transaction hash from the blockchain (hex-encoded).
   * Allows verification on Stellar explorer.
   */
  @Column({ name: 'tx_hash', type: 'varchar', length: 255 })
  @Index()
  txHash: string;

  /**
   * Transaction status (pending, success, failed).
   */
  @Column({
    name: 'tx_status',
    type: 'varchar',
    length: 50,
    default: 'success',
  })
  txStatus: 'pending' | 'success' | 'failed';

  /**
   * Ledger sequence number for the transaction.
   */
  @Column({ name: 'ledger_seq', type: 'bigint', nullable: true })
  ledgerSeq: number | null;

  /**
   * Human-readable description of the action.
   */
  @Column({ name: 'action_description', type: 'text', nullable: true })
  actionDescription: string | null;

  /**
   * Client IP address for audit trail.
   */
  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  /**
   * Timestamp when the action was triggered.
   */
  @CreateDateColumn({ type: 'timestamp with time zone' })
  @Index()
  createdAt: Date;

  /**
   * Additional context or error message if transaction failed.
   */
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;
}
