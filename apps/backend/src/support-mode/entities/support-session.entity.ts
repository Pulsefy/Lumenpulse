import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface SupportEndpointAccess {
  method: string;
  path: string;
  at: string;
}

/**
 * One read-only "view as user" support session. The row is the single source
 * of truth: a support token is only honoured while its row is neither ended
 * nor past `expiresAt`, and `expiresAt` is fixed at creation (never extended).
 */
@Entity('support_sessions')
@Index(['actorId', 'startedAt'])
@Index(['subjectId', 'startedAt'])
export class SupportSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  actorId: string;

  @Column({ type: 'uuid' })
  subjectId: string;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  endpoints: SupportEndpointAccess[];
}
