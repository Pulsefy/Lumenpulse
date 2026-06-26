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
import { User } from '../users/user.entity';

/**
 * Notification delivery channels
 */
export enum NotificationChannel {
  IN_APP = 'in_app',
  EMAIL = 'email',
  PUSH = 'push',
  WEBHOOK = 'webhook',
  SMS = 'sms',
}

/**
 * Notification event categories
 */
export enum NotificationEventCategory {
  ANOMALY = 'anomaly',
  SENTIMENT_SPIKE = 'sentiment_spike',
  SYSTEM_ALERT = 'system_alert',
  PRICE_THRESHOLD = 'price_threshold',
  PORTFOLIO_UPDATE = 'portfolio_update',
  SECURITY_ALERT = 'security_alert',
  MARKETING = 'marketing',
  ALL = 'all',
}

/**
 * User notification preferences entity
 * Stores per-user preferences for notification delivery channels and event categories
 */
@Entity('notification_preferences')
@Index(['userId'], { unique: true })
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  /**
   * Enabled channels for notification delivery
   * Stored as JSON array: ['in_app', 'email', 'push']
   */
  @Column({
    type: 'jsonb',
    default: [NotificationChannel.IN_APP],
  })
  enabledChannels: NotificationChannel[];

  /**
   * Event category preferences
   * Maps event categories to channel preferences
   * Example: {
   *   "anomaly": { "enabled": true, "channels": ["in_app", "email"] },
   *   "marketing": { "enabled": false, "channels": [] }
   * }
   */
  @Column({
    type: 'jsonb',
    default: {},
  })
  eventPreferences: Record<string, EventCategoryPreference>;

  /**
   * Quiet hours configuration
   * Suppress non-critical notifications during specified hours
   */
  @Column({
    type: 'jsonb',
    nullable: true,
  })
  quietHours: QuietHoursConfig | null;

  /**
   * Maximum notifications per day (0 = unlimited)
   */
  @Column({ type: 'int', default: 0 })
  dailyLimit: number;

  /**
   * Minimum severity level to receive notifications
   * Only notifications at or above this severity will be delivered
   */
  @Column({ type: 'varchar', length: 20, default: 'low' })
  minSeverity: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/**
 * Preference for a specific event category
 */
export interface EventCategoryPreference {
  /** Whether this event category is enabled */
  enabled: boolean;

  /** Channels to use for this event category */
  channels: NotificationChannel[];

  /** Override minimum severity for this category */
  minSeverity?: string;
}

/**
 * Quiet hours configuration
 */
export interface QuietHoursConfig {
  /** Start hour (0-23) */
  startHour: number;

  /** End hour (0-23) */
  endHour: number;

  /** Timezone (e.g., 'UTC', 'America/New_York') */
  timezone: string;

  /** Allow critical notifications during quiet hours */
  allowCritical: boolean;
}
