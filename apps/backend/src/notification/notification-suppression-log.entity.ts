import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum SuppressionReason {
  QUIET_HOURS = 'quiet_hours',
  SEVERITY_THRESHOLD = 'severity_threshold',
  DAILY_LIMIT = 'daily_limit',
  EVENT_CATEGORY_DISABLED = 'event_category_disabled',
  NOT_IN_WATCHLIST = 'not_in_watchlist',
  NO_PREFERENCES = 'no_preferences',
  CHANNEL_UNAVAILABLE = 'channel_unavailable',
}

@Entity('notification_suppression_logs')
@Index(['userId'])
@Index(['eventCategory'])
@Index(['reason'])
@Index(['createdAt'])
@Index(['userId', 'eventCategory'])
export class NotificationSuppressionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 50 })
  eventCategory: string;

  @Column({ type: 'varchar', length: 50 })
  notificationType: string;

  @Column({
    type: 'enum',
    enum: SuppressionReason,
  })
  reason: SuppressionReason;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
