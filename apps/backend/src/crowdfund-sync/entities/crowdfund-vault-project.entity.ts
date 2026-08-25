import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Tracks the relationship between vault addresses and project IDs.
 * This is populated from the ProjectRegistry or manually configured.
 */
@Entity('crowdfund_vault_projects')
@Index(['projectId'])
export class CrowdfundVaultProject {
  @PrimaryColumn({ name: 'vault_address', type: 'varchar', length: 56 })
  vaultAddress!: string;

  @Column({ name: 'project_id', type: 'varchar' })
  projectId!: string;

  @Column({
    name: 'contract_address',
    type: 'varchar',
    length: 56,
    nullable: true,
  })
  contractAddress?: string;

  @Column({
    name: 'token_address',
    type: 'varchar',
    length: 56,
    nullable: true,
  })
  tokenAddress?: string;

  @Column({
    name: 'owner_address',
    type: 'varchar',
    length: 56,
    nullable: true,
  })
  ownerAddress?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'metadata_uri', type: 'varchar', nullable: true })
  metadataUri?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'last_synced_at', type: 'timestamp', nullable: true })
  lastSyncedAt?: Date;
}
