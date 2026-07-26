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
import { ReviewerAssignment, ReviewerAssignmentState } from './reviewer-assignment.entity';

@Entity('assignment_audit_logs')
@Index(['assignmentId'])
@Index(['actorId'])
@Index(['itemId', 'itemType'])
@Index(['createdAt'], { synchronize: false })
export class AssignmentAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'assignment_id', type: 'uuid' })
  assignmentId: string;

  @ManyToOne(() => ReviewerAssignment, (assignment) => assignment.auditLogs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'assignment_id' })
  assignment: ReviewerAssignment;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'item_type' })
  itemType: string;

  @Column()
  action: string;

  @Column({
    name: 'previous_state',
    type: 'enum',
    enum: ReviewerAssignmentState,
    nullable: true,
  })
  previousState?: ReviewerAssignmentState;

  @Column({
    name: 'new_state',
    type: 'enum',
    enum: ReviewerAssignmentState,
    nullable: true,
  })
  newState?: ReviewerAssignmentState;

  @Column({ name: 'previous_reviewer_id', type: 'uuid', nullable: true })
  previousReviewerId?: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'previous_reviewer_id' })
  previousReviewer?: User;

  @Column({ name: 'new_reviewer_id', type: 'uuid', nullable: true })
  newReviewerId?: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'new_reviewer_id' })
  newReviewer?: User;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'actor_id' })
  actor: User;

  @Column({ name: 'actor_email', nullable: true })
  actorEmail?: string;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
