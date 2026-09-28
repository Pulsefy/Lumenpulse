import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('message_template_audit_logs')
export class MessageTemplateAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  templateKey: string;

  @Column({ type: 'varchar', length: 20 })
  action: 'create' | 'update';

  @Column({ type: 'int' })
  previousVersion: number;

  @Column({ type: 'int' })
  newVersion: number;

  @Column({ type: 'jsonb' })
  previousSnapshot: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  newSnapshot: Record<string, unknown>;

  @Index()
  @Column({ type: 'varchar', length: 200, nullable: true })
  actor: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  @Index()
  changedAt: Date;
}
