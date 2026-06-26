import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('stellar_sync_checkpoints')
@Index(['updatedAt'])
export class StellarSyncCheckpoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  type: string;

  @Column()
  cursor: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
