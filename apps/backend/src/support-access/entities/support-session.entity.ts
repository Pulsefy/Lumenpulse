import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SupportSessionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  ENDED = 'ended',
}

export interface SupportSessionEndpointRecord {
  method: string;
  path: string;
  timestamp: string;
}

@Entity('support_sessions')
@Index(['actorId'])
@Index(['subjectId'])
@Index(['status', 'expiresAt'])
export class SupportSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  actorId: string;

  @Column('uuid')
  subjectId: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason?: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  startedAt: Date;

  @Column({ type: 'timestamp with time zone' })
  expiresAt: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  endedAt?: Date | null;

  @Column({ type: 'json', default: () => "'[]" })
  endpoints: SupportSessionEndpointRecord[];

  @Column({ type: 'integer', default: 0 })
  endpointCount: number;

  @Column({ type: 'varchar', length: 20, default: SupportSessionStatus.ACTIVE })
  status: SupportSessionStatus;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;
}
