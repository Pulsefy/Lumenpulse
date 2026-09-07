import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum SavedSearchDomain {
  GRANTS = 'grants',
  PROJECTS = 'projects',
  USERS = 'users',
}

@Entity('saved_searches')
export class SavedSearch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 50, default: SavedSearchDomain.PROJECTS })
  domain: SavedSearchDomain;

  @Column({ type: 'jsonb' })
  query: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  notifyOnNewResults: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
