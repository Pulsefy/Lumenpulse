import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { WebhookDelivery } from './webhook-delivery.entity';

export enum WebhookSubscriptionStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity('webhook_subscriptions')
export class WebhookSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 120, nullable: true })
  partnerId: string | null;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 1024 })
  targetUrl: string;

  @Column({ type: 'jsonb', default: '[]' })
  eventTypes: string[];

  @Column({
    type: 'enum',
    enum: WebhookSubscriptionStatus,
    default: WebhookSubscriptionStatus.ACTIVE,
  })
  status: WebhookSubscriptionStatus;

  /**
   * Active secret used for HMAC-SHA256 signature generation.
   */
  @Column({ type: 'varchar', length: 512 })
  secret: string;

  /**
   * Unique identifier for the active secret version.
   */
  @Column({ type: 'varchar', length: 64 })
  secretId: string;

  /**
   * Previous secret retained during the Wave 9 rotation overlap window.
   */
  @Column({ type: 'varchar', length: 512, nullable: true })
  previousSecret: string | null;

  /**
   * Identifier for the previous secret version.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  previousSecretId: string | null;

  /**
   * Expiration timestamp for the previous secret's overlap window.
   */
  @Column({ type: 'timestamptz', nullable: true })
  overlapExpiresAt: Date | null;

  /**
   * Secret version sequence, incremented on each rotation.
   */
  @Column({ type: 'int', default: 1 })
  secretVersion: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @OneToMany(() => WebhookDelivery, (delivery) => delivery.subscription)
  deliveries: WebhookDelivery[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
