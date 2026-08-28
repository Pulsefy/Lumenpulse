import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { PriceAlertRule, PriceAlertCondition } from './price-alert-rule.entity';

@Entity('price_alert_evaluation_logs')
@Index(['ruleId', 'evaluatedAt'])
@Index(['triggered'])
export class PriceAlertEvaluationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  ruleId: string;

  @ManyToOne(() => PriceAlertRule, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ruleId' })
  rule: PriceAlertRule;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 50 })
  symbol: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  currentPrice: number;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  targetPrice: number;

  @Column({
    type: 'enum',
    enum: PriceAlertCondition,
  })
  condition: PriceAlertCondition;

  @Column({ type: 'boolean' })
  triggered: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  suppressedReason: string | null;

  @Column({ type: 'uuid', nullable: true })
  notificationId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  evaluatedAt: Date;
}
