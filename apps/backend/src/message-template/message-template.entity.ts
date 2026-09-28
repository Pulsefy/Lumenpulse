import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('message_templates')
export class MessageTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  key: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subjectTemplate: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  titleTemplate: string | null;

  @Column({ type: 'text', nullable: true })
  messageTemplate: string | null;

  @Column({ type: 'text', nullable: true })
  bodyTemplate: string | null;

  @Column({ type: 'jsonb', default: [] })
  requiredVariables: string[];

  @Column({ type: 'jsonb', default: {} })
  sampleVariables: Record<string, string>;

  @Column({ type: 'varchar', length: 200, nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
