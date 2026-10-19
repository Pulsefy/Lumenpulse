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

/**
 * Persists a named search query together with its filter snapshot so the
 * user can replay it exactly at a later time.
 *
 * `filters` is stored as a JSON column so it can carry any shape the
 * SearchService accepts without requiring schema migrations each time a
 * new filter is added.
 */
@Entity('saved_searches')
@Index(['userId'])
@Index(['userId', 'name'], { unique: true })
export class SavedSearch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  /** Human-readable label chosen by the user. */
  @Column({ type: 'varchar', length: 120 })
  name: string;

  /**
   * The raw query string at save time.  May be empty string when a search
   * is saved purely for its filter combination.
   */
  @Column({ type: 'varchar', length: 500, default: '' })
  query: string;

  /**
   * Opaque JSON payload that mirrors the search-filter DTOs
   * (e.g. `{ kind: 'project', status: 'VERIFIED', ownerPublicKey: '...' }`).
   * The frontend is responsible for deserialising this back into the correct
   * URL/state shape when re-running the search.
   */
  @Column({ type: 'jsonb', default: '{}' })
  filters: Record<string, unknown>;

  /**
   * When true the backend will emit a notification whenever new results
   * appear for this saved search (requires a background job to evaluate).
   * Exposed via the API so the UI can present a notification toggle.
   */
  @Column({ type: 'boolean', default: false })
  notificationsEnabled: boolean;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
