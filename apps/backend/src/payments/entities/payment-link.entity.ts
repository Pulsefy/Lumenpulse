import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum PaymentLinkStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  EXPIRED = 'expired',
  COMPLETED = 'completed',
}

@Entity('payment_links')
@Index(['organizationId', 'linkId'], { unique: true })
@Index(['organizationId', 'status'])
@Index(['status', 'createdAt'])
@Index(['expiresAt'])
export class PaymentLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  organizationId: string;

  @Column({ type: 'varchar', length: 100 })
  linkId: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 255 })
  tokenAddress: string;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  currency: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  recipient: string | null;

  @Column({
    type: 'enum',
    enum: PaymentLinkStatus,
    default: PaymentLinkStatus.ACTIVE,
  })
  status: PaymentLinkStatus;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}