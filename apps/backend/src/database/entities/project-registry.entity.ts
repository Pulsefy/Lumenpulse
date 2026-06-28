import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('project_registry')
export class ProjectRegistryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Index()
  projectId: string;

  @Column()
  owner: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  metadataCid: string;

  @Column({ default: 'active' })
  status: string;

  @Column()
  lastLedgerSeq: number;

  @Column()
  lastTxHash: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
