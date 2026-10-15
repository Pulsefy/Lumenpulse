import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity({ name: 'feature_flags' })
export class FeatureFlag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 200 })
  key: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  /**
   * Percentage of principals (0-100) the flag targets, or null for no rollout.
   *
   * When set, this value alone determines the evaluation result — `enabled` is
   * not consulted — so a rollout can serve a fraction of users and later be
   * widened. 0 is a real value meaning "serve nobody", which makes it the
   * single-field kill switch. Null leaves the flag on plain on/off.
   */
  @Column({ type: 'integer', nullable: true })
  rolloutPercentage: number | null;

  /** Principal IDs always granted the flag, regardless of the rollout percentage. */
  @Column({ type: 'jsonb', nullable: true, default: null })
  allowList: string[] | null;

  /** Principal IDs always denied the flag; takes precedence over `allowList`. */
  @Column({ type: 'jsonb', nullable: true, default: null })
  denyList: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  conditions: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  changedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
