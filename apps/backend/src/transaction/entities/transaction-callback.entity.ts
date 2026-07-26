import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum TransactionCallbackStatus {
  PENDING = 'PENDING',
  FINALIZED = 'FINALIZED',
  NOTIFIED = 'NOTIFIED',
  FAILED_TO_NOTIFY = 'FAILED_TO_NOTIFY',
}

@Entity('transaction_callbacks')
export class TransactionCallback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  transactionHash: string;

  @Column()
  callbackUrl: string;

  @Column({
    type: 'enum',
    enum: TransactionCallbackStatus,
    default: TransactionCallbackStatus.PENDING,
  })
  status: TransactionCallbackStatus;

  @Column({ nullable: true })
  secretId: string | null;

  @Column({ nullable: true })
  previousSecretId: string | null;

  @Column({ nullable: true })
  lastError: string;

  @Column({ default: 0 })
  retryCount: number;

  @Column({ nullable: true })
  lastDeliveryStatus: string | null;

  @Column({ nullable: true })
  lastSignature: string | null;

  @Column({ nullable: true })
  lastResponseStatusCode: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastDeliveredAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastDeliveryError: string | null;

  @Column({ type: 'jsonb', nullable: true })
  deliveryHistory: Array<Record<string, unknown>> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
