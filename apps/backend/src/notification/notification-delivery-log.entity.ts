import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { NotificationChannel } from './notification-preference.entity';
import { NotificationSeverity } from './notification.entity';

/**
 * Delivery status
 */
export enum DeliveryStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

/**
 * Notification delivery log entity
 * Tracks each attempt to deliver a notification to a user via a specific channel
 */
@Entity('notification_delivery_logs')
@Index(['notificationId'])
@Index(['userId'])
@Index(['channel', 'status'])
@Index(['createdAt'])
@Index(['userId', 'createdAt'])
@Index(['status', 'retryCount'])
export class NotificationDeliveryLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** ID of the notification being delivered */
  @Column({ type: 'uuid' })
  notificationId: string;

  /** User ID the notification is being sent to */
  @Column({ type: 'uuid' })
  userId: string;

  /** Delivery channel used */
  @Column({
    type: 'enum',
    enum: NotificationChannel,
  })
  channel: NotificationChannel;

  /** Delivery status */
  @Column({
    type: 'enum',
    enum: DeliveryStatus,
    default: DeliveryStatus.PENDING,
  })
  status: DeliveryStatus;

  /** Event category that triggered this notification */
  @Column({ type: 'varchar', length: 50, nullable: true })
  eventCategory: string | null;

  /** Notification severity */
  @Column({
    type: 'enum',
    enum: NotificationSeverity,
    nullable: true,
  })
  severity: NotificationSeverity | null;

  /** Error message if delivery failed */
  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  /** Number of retry attempts */
  @Column({ type: 'int', default: 0 })
  retryCount: number;

  /** Metadata about the delivery attempt */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  /** Timestamp when delivery was attempted */
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
