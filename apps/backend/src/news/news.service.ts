import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { News } from './news.entity';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

interface RawOverallResult {
  average: string | null;
  totalArticles: string;
}

interface RawSourceResult {
  source: string;
  averageScore: string;
  articleCount: string;
}

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
      order: { publishedAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<News | null> {
    return this.newsRepository.findOne({ where: { id } });
  }

  async findByUrl(url: string): Promise<News | null> {
    return this.newsRepository.findOne({ where: { url } });
  }

  async update(
    id: string,
    updateArticleDto: UpdateArticleDto,
  ): Promise<News | null> {
    await this.newsRepository.update(id, updateArticleDto);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.newsRepository.delete(id);
  }

  async findBySource(source: string): Promise<News[]> {
    return this.newsRepository.find({
      where: { source },
      order: { publishedAt: 'DESC' },
    });
  }

  async findBySentimentRange(
    minScore: number,
    maxScore: number,
  ): Promise<News[]> {
    return this.newsRepository
      .createQueryBuilder('news')
      .where('news.sentimentScore IS NOT NULL')
      .andWhere('news.sentimentScore >= :minScore', { minScore })
      .andWhere('news.sentimentScore <= :maxScore', { maxScore })
      .orderBy('news.publishedAt', 'DESC')
      .getMany();
  }

  async findUnscoredArticles(): Promise<News[]> {
    return this.newsRepository.find({
      where: { sentimentScore: IsNull() },
      order: { publishedAt: 'DESC' },
      take: 100,
    });
  }

  async getSentimentSummary(): Promise<{
    overall: { averageSentiment: number; totalArticles: number };
    bySource: { source: string; averageScore: number; articleCount: number }[];
  }> {
    const overall = await this.newsRepository
      .createQueryBuilder('news')
      .select('AVG(news.sentimentScore)', 'average')
      .addSelect('COUNT(news.id)', 'totalArticles')
      .where('news.sentimentScore IS NOT NULL')
      .getRawOne<RawOverallResult>();

    const bySource = await this.newsRepository
      .createQueryBuilder('news')
      .select('news.source', 'source')
      .addSelect('AVG(news.sentimentScore)', 'averageScore')
      .addSelect('COUNT(news.id)', 'articleCount')
      .where('news.sentimentScore IS NOT NULL')
      .groupBy('news.source')
      .orderBy('averageScore', 'DESC')
      .getRawMany<RawSourceResult>();

    return {
      overall: {
        averageSentiment: parseFloat(overall?.average ?? '0') || 0,
        totalArticles: parseInt(overall?.totalArticles ?? '0', 10),
      },
      bySource: bySource.map((r) => ({
        source: r.source,
        averageScore: parseFloat(r.averageScore),
        articleCount: parseInt(r.articleCount, 10),
      })),
    };
  }
}
