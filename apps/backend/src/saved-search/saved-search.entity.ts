import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from '../users/entities/user.entity';

export enum SavedSearchDomain {
  PROJECTS = 'projects',
  GRANTS = 'grants',
  NEWS = 'news',
}

@Entity('saved_searches')
@Index(['userId'])
@Index(['domain'])
export class SavedSearch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    type: 'enum',
    enum: SavedSearchDomain,
  })
  domain: SavedSearchDomain;

  @Column({ type: 'jsonb' })
  query: Record<string, unknown>;

  @Column({ type: 'boolean', default: true })
  isSubscribed: boolean;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
