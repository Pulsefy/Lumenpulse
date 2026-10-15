import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum VerificationRequestTargetType {
  CONTRIBUTOR = 'CONTRIBUTOR',
  PROJECT = 'PROJECT',
}

export enum VerificationRequestStatus {
  SUBMITTED = 'SUBMITTED',
  IN_REVIEW = 'IN_REVIEW',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

@Entity('verification_requests')
@Index(['targetType', 'targetId'])
@Index(['requesterId', 'status'])
@Index(['status', 'createdAt'])
export class VerificationRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: VerificationRequestTargetType })
  targetType: VerificationRequestTargetType;

  @Column({ type: 'varchar', length: 255 })
  targetId: string;

  @Column({ type: 'uuid' })
  requesterId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requesterId' })
  requester: User;

  @Column({ type: 'enum', enum: VerificationRequestStatus })
  status: VerificationRequestStatus;

  @Column({ type: 'text' })
  evidence: string;

  @Column({ type: 'text', nullable: true })
  requesterNote?: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewerId?: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewerId' })
  reviewer?: User | null;

  @Column({ type: 'text', nullable: true })
  reviewNote?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt?: Date | null;

  @VersionColumn()
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
