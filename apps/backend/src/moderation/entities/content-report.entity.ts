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

export enum ReportType {
  PROJECT = 'project',
  COMMENT = 'comment',
  USER = 'user',
  OTHER = 'other',
}

export enum ReportStatus {
  PENDING = 'pending',
  UNDER_REVIEW = 'under_review',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

export enum ReportReason {
  SPAM = 'spam',
  INAPPROPRIATE_CONTENT = 'inappropriate_content',
  FRAUD = 'fraud',
  MISLEADING_INFO = 'misleading_info',
  COPYRIGHT_VIOLATION = 'copyright_violation',
  OTHER = 'other',
}

@Entity('content_reports')
@Index(['targetId', 'targetType'])
@Index(['status'])
@Index(['reporterId'])
export class ContentReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: ReportType,
    nullable: false,
  })
  targetType: ReportType;

  @Column({ name: 'target_id', nullable: false })
  targetId: string;

  @Column({
    type: 'enum',
    enum: ReportReason,
    nullable: false,
  })
  reason: ReportReason;

  @Column({ name: 'description', type: 'text', nullable: true })
  description?: string;

  @Column({
    type: 'enum',
    enum: ReportStatus,
    default: ReportStatus.PENDING,
  })
  status: ReportStatus;

  @Column({ name: 'reporter_id', nullable: false })
  reporterId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'reporter_id' })
  reporter: User;

  @Column({ name: 'reviewer_id', nullable: true })
  reviewerId?: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'reviewer_id' })
  reviewer?: User;

  @Column({ name: 'review_notes', type: 'text', nullable: true })
  reviewNotes?: string;

  @Column({ name: 'resolved_at', nullable: true })
  resolvedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
