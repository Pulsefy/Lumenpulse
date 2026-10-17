import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';

export enum ModerationDecisionType {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ESCALATED = 'escalated',
}

@Entity('moderation_decisions')
@Index(['targetId', 'targetType'])
@Index(['reviewerId'])
export class ModerationDecision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Target identifier the decision applies to' })
  @Column({ name: 'target_id', nullable: false })
  targetId: string;

  @ApiProperty({ description: 'Target type (e.g. project, comment, user)' })
  @Column({ name: 'target_type', type: 'varchar', length: 50, nullable: false })
  targetType: string;

  @ApiProperty({
    enum: ModerationDecisionType,
    enumName: 'ModerationDecisionType',
  })
  @Column( {
    type: 'enum',
    enum: ModerationDecisionType,
    name: 'decision_type',
    nullable: false,
  })
  decisionType: ModerationDecisionType;

  @ApiProperty({ description: 'Reviewer user ID' })
  @Column({ name: 'reviewer_id', nullable: false })
  reviewerId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'reviewer_id' })
  reviewer: User;

  @ApiProperty({ description: 'Rationale for the decision' })
  @Column({ type: 'text', nullable: false })
  rationale: string;

  @ApiProperty({
    description: 'Optional metadata attached to the decision',
    required: false,
  })
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @ApiProperty({ description: 'Timestamp when the decision was made' })
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
