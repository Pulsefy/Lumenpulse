import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum PaymentTransactionStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('payment_transactions')
@Index(['paymentLinkId'])
@Index(['organizationId'])
@Index(['transactionHash'], { unique: true })
@Index(['senderPublicKey'])
@Index(['receiverPublicKey'])
@Index(['createdAt'])
@Index(['status'])
export class PaymentTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  paymentLinkId: string;

  @Column({ type: 'uuid' })
  organizationId: string;

  @Column({ type: 'varchar', length: 128, unique: true })
  transactionHash: string;

  @Column({ type: 'varchar', length: 128 })
  senderPublicKey: string;

  @Column({ type: 'varchar', length: 128 })
  receiverPublicKey: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  tokenAddress: string | null;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ type: 'bigserial' })
  fee: string;

  @Column({
    type: 'enum',
    enum: PaymentTransactionStatus,
    default: PaymentTransactionStatus.PENDING,
  })
  status: PaymentTransactionStatus;

  @Column({ type: 'timestamptz', nullable: true })
  settledAt: Date | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}