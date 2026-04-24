import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('stellar_sync_checkpoints')
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
