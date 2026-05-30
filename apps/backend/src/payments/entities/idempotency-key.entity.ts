import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('idempotency_keys')
@Index(['key'], { unique: true })
@Index(['organizationId'])
@Index(['createdAt'])
export class IdempotencyKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  key: string;

  @Column({ type: 'uuid' })
  organizationId: string;

  @Column({ type: 'uuid', nullable: true })
  paymentLinkId: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  transactionHash: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  result: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}