import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ProjectSubmission } from './project-submission.entity';

export enum FeedbackType {
  COMMENT = 'comment',
  REQUEST_CHANGES = 'request_changes',
  APPROVAL = 'approval',
  REJECTION = 'rejection',
}

@Entity('review_feedback')
@Index(['submissionId'])
@Index(['reviewerId'])
@Index(['createdAt'])
@Index(['submissionId', 'reviewerId'])
export class ReviewFeedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  submissionId: string;

  @ManyToOne(
    () => ProjectSubmission,
    (submission) => submission.reviewFeedback,
    { onDelete: 'CASCADE' }
  )
  @JoinColumn({ name: 'submissionId' })
  submission: ProjectSubmission;

  @Column({ type: 'uuid' })
  reviewerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reviewerId' })
  reviewer: User;

  @Column({
    type: 'enum',
    enum: FeedbackType,
  })
  type: FeedbackType;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'json', nullable: true })
  suggestions?: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  isResolved: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
