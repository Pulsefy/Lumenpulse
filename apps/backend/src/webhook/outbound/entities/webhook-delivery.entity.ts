import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WebhookSubscription } from './webhook-subscription.entity';

export enum WebhookDeliveryStatus {
  PENDING = 'PENDING',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  DEAD_LETTER = 'DEAD_LETTER',
}

@Entity('webhook_deliveries')
@Index('IDX_webhook_deliveries_sub_created', ['subscriptionId', 'createdAt'])
@Index('IDX_webhook_deliveries_status_next_retry', ['status', 'nextRetryAt'])
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  subscriptionId: string;

  @ManyToOne(() => WebhookSubscription, (sub) => sub.deliveries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'subscriptionId' })
  subscription: WebhookSubscription;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  eventType: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: WebhookDeliveryStatus,
    default: WebhookDeliveryStatus.PENDING,
  })
  status: WebhookDeliveryStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'int', default: 5 })
  maxAttempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  nextRetryAt: Date | null;

  @Column({ type: 'int', nullable: true })
  responseStatusCode: number | null;

  @Column({ type: 'text', nullable: true })
  responseBody: string | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'jsonb', nullable: true })
  requestHeaders: Record<string, string> | null;

  @Column({ type: 'int', nullable: true })
  executionDurationMs: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
