import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum NotificationType {
  ANOMALY = 'anomaly',
  SENTIMENT_SPIKE = 'sentiment_spike',
  SYSTEM = 'system',
}

export enum NotificationSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

@Entity('notifications')
@Index(['userId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  type: NotificationType;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'varchar', length: 20, default: NotificationSeverity.LOW })
  severity: NotificationSeverity;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false })
  read: boolean;

  // null = broadcast notification visible to all users
  @Column({ type: 'uuid', nullable: true })
  @Index()
  userId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
