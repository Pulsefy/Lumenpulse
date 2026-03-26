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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
