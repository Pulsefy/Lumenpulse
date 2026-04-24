import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  Index,
  JoinColumn,
  BeforeInsert,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ReviewFeedback } from './review-feedback.entity';

export enum SubmissionStatus {
  DRAFT = 'draft',
  UNDER_REVIEW = 'under_review',
  CHANGES_REQUESTED = 'changes_requested',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PUBLISHED = 'published',
}

export enum ProjectType {
  NEWS_AGGREGATOR = 'news_aggregator',
  PORTFOLIO_TRACKER = 'portfolio_tracker',
  TRADING_BOT = 'trading_bot',
  DeFi_PROTOCOL = 'defi_protocol',
  EDUCATIONAL = 'educational',
  OTHER = 'other',
}

@Entity('project_submissions')
@Index(['creatorId'])
@Index(['status'])
@Index(['createdAt'])
@Index(['updatedAt'])
@Index(['publishedAt'])
@Index(['creatorId', 'status'])
export class ProjectSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  creatorId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'creatorId' })
  creator: User;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text', nullable: true })
  detailedContent: string;

  @Column({
    type: 'enum',
    enum: ProjectType,
    default: ProjectType.OTHER,
  })
  projectType: ProjectType;

  @Column({
    type: 'enum',
    enum: SubmissionStatus,
    default: SubmissionStatus.DRAFT,
  })
  status: SubmissionStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  repositoryUrl: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  liveUrl: string;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown>;

  @Column({ type: 'uuid', nullable: true })
  reviewedById: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reviewedById' })
  reviewedBy?: User;

  @Column({ type: 'timestamp', nullable: true })
  submittedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  publishedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  rejectedAt: Date;

  @OneToMany(
    () => ReviewFeedback,
    (feedback) => feedback.submission,
    { cascade: true }
  )
  reviewFeedback: ReviewFeedback[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date;

  @Column({ type: 'int', default: 0 })
  version: number;

  @BeforeInsert()
  generateDefaults() {
    if (!this.metadata) {
      this.metadata = {};
    }
  }
}
