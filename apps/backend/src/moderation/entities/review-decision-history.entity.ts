import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum DecisionType {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  DEFERRED = 'deferred',
  ESCALATED = 'escalated',
}

@Entity('review_decision_history')
@Index(['targetId', 'targetType'])
@Index(['reviewerId'])
@Index(['decisionType'])
export class ReviewDecisionHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'target_id', nullable: false })
  targetId: string;

  @Column({
    name: 'target_type',
    type: 'varchar',
    length: 50,
    nullable: false,
  })
  targetType: string;

  @Column({
    type: 'enum',
    enum: DecisionType,
    nullable: false,
  })
  decisionType: DecisionType;

  @Column({ name: 'reviewer_id', nullable: false })
  reviewerId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'reviewer_id' })
  reviewer: User;

  @Column({ type: 'text', nullable: true })
  rationale?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({
    name: 'previous_decision',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  previousDecision?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
