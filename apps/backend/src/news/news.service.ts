import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { News } from './news.entity';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

@Injectable()
export class NewsService {
  constructor(
    @InjectRepository(News)
    private newsRepository: Repository<News>,
  ) {}

  async create(createArticleDto: CreateArticleDto): Promise<News> {
    const news = this.newsRepository.create(createArticleDto);
    return this.newsRepository.save(news);
  }

  async findAll(): Promise<News[]> {
    return this.newsRepository.find({
      order: {
        publishedAt: 'DESC',
      },
    });
  }

  async findOne(id: string): Promise<News | null> {
    return this.newsRepository.findOne({
      where: { id },
    });
  }

  async findByUrl(url: string): Promise<News | null> {
    return this.newsRepository.findOne({
      where: { url },
    });
  }

  async update(id: string, updateArticleDto: UpdateArticleDto): Promise<News | null> {
    await this.newsRepository.update(id, updateArticleDto);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.newsRepository.delete(id);
  }

  async findBySource(source: string): Promise<News[]> {
    return this.newsRepository.find({
      where: { source },
      order: {
        publishedAt: 'DESC',
      },
    });
  }

  async findBySentimentRange(
    minScore: number,
    maxScore: number,
  ): Promise<News[]> {
    return this.newsRepository
      .createQueryBuilder('news')
      .where('news.sentimentScore >= :minScore', { minScore })
      .andWhere('news.sentimentScore <= :maxScore', { maxScore })
      .orderBy('news.publishedAt', 'DESC')
      .getMany();
  }
}
