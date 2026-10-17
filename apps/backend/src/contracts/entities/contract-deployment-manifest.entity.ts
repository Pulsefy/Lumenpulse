import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Lifecycle state of a deployed contract within a manifest.
 *
 * - active:      fully operational; writes and exits are allowed.
 * - deprecated:  no new writes are accepted, but existing users may exit.
 * - sunset:      read-only / exit-only; scheduled for removal from the manifest.
 * - removed:     no longer part of the active manifest.
 */
export enum ContractLifecycleState {
  ACTIVE = 'active',
  DEPRECATED = 'deprecated',
  SUNSET = 'sunset',
  REMOVED = 'removed',
}

/**
 * Audited record of a lifecycle transition for a contract in a manifest.
 */
export interface ContractLifecycleAuditEntry {
  /** Contract identifier within the manifest */
  contractId: string;
  /** Previous lifecycle state */
  fromState: ContractLifecycleState;
  /** New lifecycle state */
  toState: ContractLifecycleState;
  /** Actor who authorised the transition */
  authorisedBy: string;
  /** Human-readable reason for the transition */
  reason: string | null;
  /** When the transition occurred */
  timestamp: string;
}

@Entity('contract_deployment_manifests')
@Index(['environment'])
@Index(['isActive'])
@Index(['createdAt'])
@Index(['lifecycleState'])
export class ContractDeploymentManifest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Network environment e.g. 'testnet', 'mainnet', 'futurenet' */
  @Column({ type: 'varchar', length: 50, default: 'testnet' })
  environment: string;

  /** Manifest version tag or release label e.g. 'v1.0.0' */
  @Column({ type: 'varchar', length: 100, nullable: true })
  version: string | null;

  /** Map of contract identifiers, WASM hashes, addresses, init params */
  @Column({ type: 'jsonb' })
  contracts: Record<string, any>;

  /** Additional environment metadata (rpc_url, admin_address, network, git commit, etc.) */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  /** Whether this manifest is currently the active manifest for the environment */
  @Column({ type: 'boolean', default: false })
  isActive: boolean;

  /**
   * Map of contract identifier -> lifecycle state.
   * Defaults to active for any contract not explicitly listed.
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  lifecycleState: Record<string, ContractLifecycleState>;

  /** Audit trail of deprecation / sunset transitions */
  @Column({ type: 'jsonb', default: [] })
  lifecycleAudit: ContractLifecycleAuditEntry[];

  /** When the manifest entered deprecation (if applicable) */
  @Column({ type: 'timestamp with time zone', nullable: true })
  deprecatedAt: Date | null;

  /** ID of user or admin who created this record */
  @Column({ type: 'varchar', length: 255, nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;
}
