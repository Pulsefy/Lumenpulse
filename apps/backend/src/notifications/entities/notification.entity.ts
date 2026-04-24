import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/entities/user.entity';

export enum NotificationType {
  PRICE_ALERT = 'price_alert',
  NEWS_ALERT = 'news_alert',
  SECURITY_ALERT = 'security_alert',
  ACCOUNT_ACTIVITY = 'account_activity',
}

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({
    type: 'enum',
    enum: NotificationType,
    default: NotificationType.ACCOUNT_ACTIVITY,
  })
  type: NotificationType;

  @Column({ default: false })
  read: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
