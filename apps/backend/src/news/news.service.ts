import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { News } from './news.entity';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { NewsProviderService } from './news-provider.service';

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);

  constructor(
    @InjectRepository(News)
    private newsRepository: Repository<News>,
    private readonly newsProviderService: NewsProviderService,
  ) { }

  @Cron('*/15 * * * *')
  async handleCron() {
    this.logger.log('Starting scheduled news ingestion...');
    try {
      const { articles } = await this.newsProviderService.getLatestArticles();
      let newArticlesCount = 0;

      for (const articleDto of articles) {
        const existing = await this.findByUrl(articleDto.url);
        if (!existing) {
          await this.create({
            title: articleDto.title,
            url: articleDto.url,
            source: articleDto.source,
            publishedAt: articleDto.publishedAt,
            sentimentScore: 0, // Default sentiment score
          } as CreateArticleDto);
          newArticlesCount++;
        }
      }

      this.logger.log(
        `News ingestion completed. Fetched ${articles.length} articles, ${newArticlesCount} new.`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to fetch news articles: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

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
