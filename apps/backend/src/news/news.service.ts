import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { News } from './news.entity';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { NewsProviderService } from './news-provider.service';
import { NewsArticleDto } from './dto/news-article.dto';
import { CacheService } from '../cache/cache.service';
import { QueryProfilerService } from '../common/profiling/query-profiler.service';
import { TranslationService } from '../translation/translation.service';

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
    private readonly profiler: QueryProfilerService,
    private readonly translationService: TranslationService,
    private readonly configService: ConfigService,
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
    return this.profiler.profile(
      async () => {
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
      },
      { label: 'NewsService.findAll', thresholdMs: 150 },
    );
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
    return this.profiler.profile(
      async () => {
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
      },
      { label: 'NewsService.getSentimentSummary', thresholdMs: 200 },
    );
  }

  /**
   * Creates a new article if it doesn't already exist (based on URL).
   * Returns the existing article if found, or the newly created article.
   * Applies translation and normalization pipeline before saving.
   */
  async createOrIgnore(articleDto: NewsArticleDto): Promise<News | null> {
    // Check if article already exists by URL
    const existingArticle = await this.findByUrl(articleDto.url);
    if (existingArticle) {
      return null; // Return null to indicate it was skipped
    }

    // Apply translation and normalization pipeline
    const translationEnabled = this.configService.get<boolean>(
      'TRANSLATION_ENABLED',
      true,
    );

    let processedTitle = articleDto.title;
    let originalTitle: string | null = null;
    let originalLanguage: string | null = null;
    let translationConfidence: number | null = null;
    let isTranslated = false;

    if (translationEnabled) {
      try {
        const result = await this.translationService.translateAndNormalize(
          articleDto.title,
          articleDto.body || '',
        );

        processedTitle = result.title;
        originalLanguage = result.originalLanguage;
        translationConfidence = result.translationConfidence;

        // Store original title if it was translated
        if (originalLanguage && originalLanguage !== 'en') {
          originalTitle = articleDto.title;
          isTranslated = true;
        }
      } catch (error) {
        this.logger.warn(
          `Translation failed for article ${articleDto.url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        // Continue with original content if translation fails
        processedTitle = this.translationService.normalizeText(
          articleDto.title,
        );
      }
    } else {
      // Just normalize if translation is disabled
      processedTitle = this.translationService.normalizeText(articleDto.title);
    }

    // Create new article with translation metadata
    const article = this.newsRepository.create({
      title: processedTitle,
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
      originalTitle,
      originalLanguage,
      translationConfidence,
      isTranslated,
      normalizedAt: new Date(),
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

  /**
   * Get translation statistics for all articles
   */
  async getTranslationStats(): Promise<{
    totalArticles: number;
    translatedArticles: number;
    englishArticles: number;
    languageBreakdown: Record<string, number>;
    averageConfidence: number;
  }> {
    const total = await this.newsRepository.count();
    const translated = await this.newsRepository.count({
      where: { isTranslated: true },
    });

    // Get language breakdown
    const languageStats = await this.newsRepository
      .createQueryBuilder('news')
      .select('news.originalLanguage', 'language')
      .addSelect('COUNT(*)', 'count')
      .where('news.originalLanguage IS NOT NULL')
      .groupBy('news.originalLanguage')
      .getRawMany();

    const languageBreakdown: Record<string, number> = {};
    for (const stat of languageStats) {
      languageBreakdown[stat.language] = parseInt(stat.count, 10);
    }

    // Calculate average confidence
    const avgResult = await this.newsRepository
      .createQueryBuilder('news')
      .select('AVG(news.translationConfidence)', 'avg')
      .where('news.translationConfidence IS NOT NULL')
      .getRawOne();

    const averageConfidence = parseFloat(avgResult?.avg || '0') || 0;

    return {
      totalArticles: total,
      translatedArticles: translated,
      englishArticles: total - translated,
      languageBreakdown,
      averageConfidence,
    };
  }

  /**
   * Find articles that need translation (no original_language set)
   */
  async findUntranslatedArticles(limit = 100): Promise<News[]> {
    return this.newsRepository.find({
      where: { originalLanguage: IsNull() },
      order: { publishedAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Retroactively translate existing articles
   * Scheduled to run daily at 2 AM
   */
  @Cron('0 0 2 * * *')
  async retroactivelyTranslateArticles(): Promise<void> {
    const translationEnabled = this.configService.get<boolean>(
      'TRANSLATION_ENABLED',
      true,
    );

    if (!translationEnabled) {
      this.logger.log('Translation is disabled, skipping retroactive job');
      return;
    }

    this.logger.log('Running retroactive translation job...');

    try {
      const untranslatedArticles = await this.findUntranslatedArticles(50);

      let processedCount = 0;
      let errorCount = 0;

      for (const article of untranslatedArticles) {
        try {
          const result = await this.translationService.translateAndNormalize(
            article.title,
            '',
          );

          const updateData: Partial<News> = {
            title: result.title,
            originalLanguage: result.originalLanguage,
            translationConfidence: result.translationConfidence,
            normalizedAt: new Date(),
          };

          // Store original title if it was translated
          if (result.originalLanguage && result.originalLanguage !== 'en') {
            updateData.originalTitle = article.title;
            updateData.isTranslated = true;
          }

          await this.newsRepository.update(article.id, updateData);
          processedCount++;
        } catch (error) {
          this.logger.error(
            `Failed to translate article ${article.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
          errorCount++;
        }
      }

      this.logger.log(
        `Retroactive translation completed. Processed: ${processedCount}, Errors: ${errorCount}`,
      );

      if (processedCount > 0) {
        await this.cacheService.invalidateNewsCache();
      }
    } catch (error) {
      this.logger.error(
        `Retroactive translation job failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Find articles by original language
   */
  async findByOriginalLanguage(language: string): Promise<News[]> {
    return this.newsRepository.find({
      where: { originalLanguage: language },
      order: { publishedAt: 'DESC' },
    });
  }
}
