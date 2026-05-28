import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('vault_indexer_cursors')
export class VaultIndexerCursor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  contractId: string;

  /** Last processed Soroban event paging cursor */
  @Column()
  cursor: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
