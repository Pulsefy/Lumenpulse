import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ProjectStatus {
  Active = 'ACTIVE',
  Expired = 'EXPIRED',
  Pending = 'PENDING',
  Archived = 'ARCHIVED',
}

@Entity('projects')
@Index(['status'])
@Index(['ownerPublicKey'])
@Index(['contractAddress'])
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 56 })
  ownerPublicKey: string;

  @Column({
    type: 'enum',
    enum: ProjectStatus,
    default: ProjectStatus.Pending,
  })
  status: ProjectStatus;

  // On-chain state fields
  @Column({ type: 'varchar', length: 56, nullable: true })
  contractAddress: string | null;

  @Column({ type: 'bigint', nullable: true })
  totalFunding: bigint | null;

  @Column({ type: 'bigint', nullable: true })
  vaultBalance: bigint | null;

  @Column({ type: 'int', nullable: true })
  contributorCount: number | null;

  @Column({ type: 'bigint', nullable: true })
  lastUpdatedLedger: bigint | null;

  // Off-chain metadata
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  websiteUrl: string | null;

  @Column({ type: 'text', nullable: true })
  githubUrl: string | null;

  @Column({ type: 'simple-array', nullable: true })
  tags: string[] | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  category: string | null;

  // Timestamps
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;
}
