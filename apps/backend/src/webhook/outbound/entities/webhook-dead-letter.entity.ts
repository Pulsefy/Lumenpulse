import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum WebhookDeadLetterStatus {
  PENDING = 'pending',
  REPLAYED = 'replayed',
  RESOLVED = 'resolved',
}

@Entity('webhook_dead_letter')
@Index('IDX_webhook_dead_letter_sub_status', ['subscriptionId', 'status'])
@Index('IDX_webhook_dead_letter_created', ['createdAt'])
export class WebhookDeadLetter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  deliveryId: string;

  @Index()
  @Column({ type: 'uuid' })
  subscriptionId: string;

  @Column({ type: 'varchar', length: 120 })
  eventType: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  lastErrorMessage: string | null;

  @Column({ type: 'jsonb', default: '[]' })
  errorHistory: Array<{
    timestamp: string;
    error: string;
    statusCode?: number | null;
  }>;

  @Column({
    type: 'enum',
    enum: WebhookDeadLetterStatus,
    default: WebhookDeadLetterStatus.PENDING,
  })
  status: WebhookDeadLetterStatus;

  @Column({ type: 'text', nullable: true })
  maintainerNotes: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  resolvedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  replayedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  replayCount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
