import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum OutboxEventStatus {
  PENDING = 'pending',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

@Entity('outbox_events')
@Index('IDX_outbox_events_status_created', ['status', 'createdAt'])
@Index(['eventType'])
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Domain event type, e.g. "user.registered", "portfolio.snapshot.created" */
  @Column({ type: 'varchar', length: 255 })
  eventType: string;

  /** Serialised event payload */
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: OutboxEventStatus,
    default: OutboxEventStatus.PENDING,
  })
  status: OutboxEventStatus;

  /** Number of dispatch attempts made */
  @Column({ type: 'integer', default: 0 })
  attempts: number;

  /** Last error message, if any */
  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  /** When the event was last processed (successfully or not) */
  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
