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

export enum CommentVisibility {
  PUBLIC = 'public',
  INTERNAL = 'internal',
}

@Entity('review_comments')
@Index(['targetId', 'targetType'])
@Index(['authorId'])
@Index(['visibility'])
export class ReviewComment {
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
    enum: CommentVisibility,
    default: CommentVisibility.PUBLIC,
  })
  visibility: CommentVisibility;

  @Column({ name: 'author_id', nullable: false })
  authorId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'author_id' })
  author: User;

  @Column({ type: 'text', nullable: false })
  content: string;

  @Column({ name: 'parent_id', nullable: true })
  parentId?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
