import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('telegram_silence')
@Index(['chatId'], { unique: true })
export class TelegramSilence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  chatId: string;

  @Column({ type: 'timestamptz' })
  silencedUntil: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
