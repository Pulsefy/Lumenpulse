import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { NewsService } from './news.service';
import { Cron, CronExpression } from '@nestjs/schedule';

interface SentimentApiResponse {
  sentiment: number;
}

@Injectable()
export class NewsSentimentService {
  private readonly logger = new Logger(NewsSentimentService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly newsService: NewsService,
    private readonly configService: ConfigService,
  ) {}

  async analyzeSentiment(text: string): Promise<number | null> {
    try {
      const baseUrl = this.configService.get<string>('PYTHON_SERVICE_URL');
      const response = await firstValueFrom<
        AxiosResponse<SentimentApiResponse>
      >(
        this.httpService.post<SentimentApiResponse>(`${baseUrl}/analyze`, {
          text,
        }),
      );
      return response.data.sentiment;
    } catch {
      // Non-blocking: return null if service is down
      this.logger.error('Sentiment service unavailable');
      return null;
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async updateMissingSentiments(): Promise<void> {
    this.logger.log('Running sentiment update job...');

    const articlesWithoutSentiment =
      await this.newsService.findUnscoredArticles();

    for (const article of articlesWithoutSentiment) {
      const score = await this.analyzeSentiment(article.title);

      if (score !== null) {
        await this.newsService.update(article.id, { sentimentScore: score });
      } else {
        this.logger.warn(`Failed to score article: ${article.id}`);
      }
    }

    this.logger.log(
      `Sentiment update done. Processed: ${articlesWithoutSentiment.length} articles.`,
    );
  }
}
