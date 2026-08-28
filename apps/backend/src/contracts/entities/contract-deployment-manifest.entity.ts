import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('contract_deployment_manifests')
@Index(['environment'])
@Index(['isActive'])
@Index(['createdAt'])
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

  /** ID of user or admin who created this record */
  @Column({ type: 'varchar', length: 255, nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;
}
