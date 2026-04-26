import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum TelegramAlertType {
  PRICE = 'price',
  SENTIMENT = 'sentiment',
  NEWS = 'news',
  PORTFOLIO = 'portfolio',
  SYSTEM = 'system',
}

@Entity('telegram_subscriptions')
@Index(['chatId'], { unique: true })
export class TelegramSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  chatId: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  username: string | null;

  @Column({
    type: 'jsonb',
    default: [
      TelegramAlertType.PRICE,
      TelegramAlertType.SENTIMENT,
      TelegramAlertType.NEWS,
    ],
  })
  alertTypes: TelegramAlertType[];

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
