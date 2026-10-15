import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Cold storage for audit records that aged out of their retention window
 * under an `archive` policy. The original row is kept verbatim in `payload`
 * so an archived record can still be handed to an auditor.
 */
@Entity('audit_log_archive')
@Index(['recordType', 'originalCreatedAt'])
@Index(['sourceTable', 'sourceId'], { unique: true })
export class AuditLogArchive {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** AuditRecordType the policy matched, e.g. "user_activity". */
  @Column({ type: 'varchar', length: 50 })
  recordType: string;

  /** Table the record was moved out of. */
  @Column({ type: 'varchar', length: 100 })
  sourceTable: string;

  /** Primary key of the record in its source table. */
  @Column({ type: 'uuid' })
  sourceId: string;

  /** The original row, serialised as JSON. */
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'timestamp with time zone' })
  originalCreatedAt: Date;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  archivedAt: Date;
}
