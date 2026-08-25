import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('feature_flag_audit')
export class FeatureFlagAudit {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'flag_key', length: 255 })
  flagKey: string;

  @Column({ length: 20 })
  action: 'upsert' | 'delete';

  @Column({ type: 'text', nullable: true, name: 'previous_value' })
  previousValue: string | null;

  @Column({ type: 'text', nullable: true, name: 'new_value' })
  newValue: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
