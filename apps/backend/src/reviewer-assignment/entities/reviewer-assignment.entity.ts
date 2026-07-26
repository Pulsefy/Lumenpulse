import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { AssignmentAuditLog } from './assignment-audit-log.entity';

export enum ReviewerAssignmentState {
  UNASSIGNED = 'unassigned',
  IN_REVIEW = 'in_review',
  COMPLETED = 'completed',
}

@Entity('reviewer_assignments')
@Index(['state'])
@Index(['reviewerId'])
@Index(['itemId', 'itemType'], { unique: true })
@Index(['createdAt', 'priority'], { synchronize: false }) // composite index
export class ReviewerAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'item_type' })
  itemType: string;

  @Column({
    type: 'enum',
    enum: ReviewerAssignmentState,
    default: ReviewerAssignmentState.UNASSIGNED,
  })
  state: ReviewerAssignmentState;

  @Column({ name: 'reviewer_id', type: 'uuid', nullable: true })
  reviewerId?: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'reviewer_id' })
  reviewer?: User;

  @Column({ name: 'assigned_by_id', type: 'uuid', nullable: true })
  assignedById?: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'assigned_by_id' })
  assignedBy?: User;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt?: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date;

  @Column({ type: 'integer', default: 0 })
  priority: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @OneToMany(() => AssignmentAuditLog, (log) => log.assignment, {
    cascade: false,
  })
  auditLogs?: AssignmentAuditLog[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
