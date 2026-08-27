import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type EntityKind = 'project' | 'asset' | 'tag' | 'category';

@Entity({ name: 'entity_aliases' })
@Index(['entityKind', 'canonicalValue'], { unique: false })
@Index(['aliasLower'], { unique: true })
export class EntityAlias {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  entityKind: EntityKind;

  @Column({ type: 'varchar', length: 255 })
  canonicalValue: string;

  @Column({ type: 'varchar', length: 255 })
  alias: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  aliasLower: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  createdBy: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
