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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
