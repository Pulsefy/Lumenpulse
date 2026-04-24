import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { News } from './news.entity';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { NewsProviderService } from './news-provider.service';
import { NewsArticleDto } from './dto/news-article.dto';
import { CacheService } from '../cache/cache.service';

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
  private readonly logger = new Logger(NewsService.name);

  constructor(
    @InjectRepository(News)
    private newsRepository: Repository<News>,
    private readonly newsProviderService: NewsProviderService,
    private readonly cacheService: CacheService,
  ) {}

  async create(createArticleDto: CreateArticleDto): Promise<News> {
    const news = this.newsRepository.create(createArticleDto);
    const saved = await this.newsRepository.save(news);
    await this.cacheService.invalidateNewsCache();
    return saved;
  }

  async findAll(filters?: {
    tag?: string;
    category?: string;
  }): Promise<News[]> {
    const qb = this.newsRepository
      .createQueryBuilder('news')
      .orderBy('news.publishedAt', 'DESC');

    if (filters?.tag) {
      qb.andWhere(':tag = ANY(news.tags)', {
        tag: filters.tag.toLowerCase(),
      });
    }

    if (filters?.category) {
      qb.andWhere('LOWER(news.category) = :category', {
        category: filters.category.toLowerCase(),
      });
    }

    return qb.getMany();
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
    await this.cacheService.invalidateNewsCache();
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

  /**
   * Creates a new article if it doesn't already exist (based on URL).
   * Returns the existing article if found, or the newly created article.
   */
  async createOrIgnore(articleDto: NewsArticleDto): Promise<News | null> {
    // Check if article already exists by URL
    const existingArticle = await this.findByUrl(articleDto.url);
    if (existingArticle) {
      return null; // Return null to indicate it was skipped
    }

    // Create new article
    const article = this.newsRepository.create({
      title: articleDto.title,
      url: articleDto.url,
      source: articleDto.source,
      publishedAt: articleDto.publishedAt
        ? new Date(articleDto.publishedAt)
        : new Date(),
      sentimentScore: null, // Will be populated by sentiment service
      tags: articleDto.keywords
        ? articleDto.keywords.map((k) => k.toLowerCase())
        : [],
      category: articleDto.categories?.[0] ?? null,
    });

    return this.newsRepository.save(article);
  }

  /**
   * Scheduled job to fetch and save new articles every 15 minutes.
   * Uses upsert logic to skip duplicates based on URL.
   */
  @Cron('0 */15 * * * *')
  async fetchAndSaveArticles(): Promise<void> {
    this.logger.log('Running scheduled news fetch job...');

    try {
      // Fetch latest articles from provider
      const response = await this.newsProviderService.getLatestArticles({
        limit: 50,
        lang: 'EN',
      });

      const articles = response.articles;
      let newCount = 0;
      let skippedCount = 0;

      // Process each article
      for (const articleDto of articles) {
        const result = await this.createOrIgnore(articleDto);
        if (result) {
          newCount++;
        } else {
          skippedCount++;
        }
      }

      this.logger.log(
        `News fetch completed. Fetched ${articles.length} articles, ${newCount} new, ${skippedCount} duplicates skipped.`,
      );

      if (newCount > 0) {
        await this.cacheService.invalidateNewsCache();
      }
    } catch (error) {
      this.logger.error(
        `Failed to fetch and save articles: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
