import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum AuditAction {
  LOGIN = 'login',
  LOGOUT = 'logout',
  PASSWORD_CHANGE = 'password_change',
  PASSWORD_RESET = 'password_reset',
  ACCOUNT_LINK = 'account_link',
  ACCOUNT_UNLINK = 'account_unlink',
  PROFILE_UPDATE = 'profile_update',
  TOKEN_REFRESH = 'token_refresh',
  LOGIN_FAILED = 'login_failed',
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Index()
  @Column({
    type: 'enum',
    enum: AuditAction,
  })
  action: AuditAction;

  @CreateDateColumn({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>;

  @Column({ type: 'varchar', length: 255, nullable: true })
  status: string;

  @Column({ type: 'text', nullable: true })
  details: string;
}
