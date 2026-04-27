import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('articles')
@Index('IDX_articles_url', ['url'], { unique: true })
@Index(['publishedAt'])
@Index(['source'])
@Index(['sentimentScore'])
@Index(['source', 'publishedAt'])
@Index(['category'])
@Index(['originalLanguage'])
@Index(['isTranslated'])
export class News {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ unique: true })
  url: string;

  @Column()
  source: string;

  @Column({ type: 'timestamp' })
  publishedAt: Date;

  @Column({ type: 'float', nullable: true })
  sentimentScore: number | null;

  @Column('text', { array: true, nullable: true, default: [] })
  tags: string[];

  @Column({ nullable: true })
  category: string | null;

  @Column({ name: 'original_language', length: 10, nullable: true })
  originalLanguage: string | null;

  @Column({ name: 'original_title', type: 'text', nullable: true })
  originalTitle: string | null;

  @Column({ name: 'translation_confidence', type: 'float', nullable: true })
  translationConfidence: number | null;

  @Column({ name: 'is_translated', default: false })
  isTranslated: boolean;

  @Column({ name: 'normalized_at', type: 'timestamp', nullable: true })
  normalizedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
