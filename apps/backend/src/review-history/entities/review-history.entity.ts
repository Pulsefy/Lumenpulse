import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ReviewDecision {
  Comment = 'COMMENT',
  Submitted = 'SUBMITTED',
  ChangesRequested = 'CHANGES_REQUESTED',
  Approved = 'APPROVED',
  Published = 'PUBLISHED',
}

@Entity('review_history')
@Index(['submissionId', 'createdAt'])
@Index(['targetType', 'targetId', 'createdAt'])
export class ReviewHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'submission_id', type: 'integer', nullable: true })
  submissionId: number | null;

  @Column({ name: 'target_type', type: 'varchar', length: 100 })
  targetType: string;

  @Column({ name: 'target_id', type: 'varchar', length: 255 })
  targetId: string;

  @Column({ type: 'enum', enum: ReviewDecision })
  decision: ReviewDecision;

  @Column({ name: 'comment', type: 'text', nullable: true })
  comment: string | null;

  @Column({ name: 'is_internal', type: 'boolean', default: false })
  isInternal: boolean;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
