import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Immutable record of every feature-flag mutation.
 *
 * One row is written for each call to FeatureFlagsService#upsert or #remove,
 * capturing who changed the flag, what it was before, and what it became.
 */
@Entity({ name: 'feature_flag_audit_logs' })
export class FlagAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The feature-flag key that was mutated. */
  @Index()
  @Column({ type: 'varchar', length: 200 })
  flagKey: string;

  /** Action performed: 'upsert' | 'remove'. */
  @Column({ type: 'varchar', length: 20 })
  action: 'upsert' | 'remove';

  /** The flag's enabled state before this mutation (null if flag did not exist). */
  @Column({ type: 'boolean', nullable: true })
  previousEnabled: boolean | null;

  /** The flag's enabled state after this mutation (null for remove). */
  @Column({ type: 'boolean', nullable: true })
  newEnabled: boolean | null;

  /**
   * Actor who requested the change — corresponds to FeatureFlag#changedBy
   * (typically an email or user ID).  Null if not provided.
   */
  @Index()
  @Column({ type: 'varchar', length: 200, nullable: true })
  actor: string | null;

  /** ISO timestamp of when this mutation was applied. */
  @CreateDateColumn({ type: 'timestamptz' })
  @Index()
  changedAt: Date;
}
