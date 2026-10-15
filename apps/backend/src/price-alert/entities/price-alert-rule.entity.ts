import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum PriceAlertCondition {
  ABOVE = 'above',
  BELOW = 'below',
}

@Entity('price_alert_rules')
@Index(['userId', 'symbol'])
@Index(['isActive'])
@Index(['symbol', 'isActive'])
export class PriceAlertRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 50 })
  symbol: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  targetPrice: number;

  @Column({
    type: 'enum',
    enum: PriceAlertCondition,
    default: PriceAlertCondition.ABOVE,
  })
  condition: PriceAlertCondition;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 60 })
  cooldownMinutes: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastTriggeredAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
