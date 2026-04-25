import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { map } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { NewsArticle } from './interfaces/news-article.interface';
import { REQUEST_ID_HEADER } from '../common/constants/request.constants';
import { CorrelationService } from '../common/correlation/correlation.service';

@Injectable()
export class NewsProviderService {
  private readonly logger = new Logger(NewsProviderService.name);
  private readonly cryptocompareUrl =
    'https://min-api.cryptocompare.com/data/v2/news/?lang=EN';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly correlationService: CorrelationService,
  ) {}

  async fetchNews(): Promise<NewsArticle[]> {
    const apiKey = this.configService.get<string>('CRYPTOCOMPARE_API_KEY');
    const correlationId = this.correlationService.getCorrelationId();

    try {
      const response$ = this.httpService
        .get(this.cryptocompareUrl, {
          headers: {
            authorization: `Apikey ${apiKey}`,
            ...(correlationId && { [REQUEST_ID_HEADER]: correlationId }),
          },
        })
        .pipe(
          map((res) => {
            return res.data.Data.map((item: any) => ({
              id: item.id,
              title: item.title,
              content: item.body,
              source: item.source,
              url: item.url,
              publishedAt: new Date(item.published_on * 1000),
            }));
          }),
        );

      return await firstValueFrom(response$);
    } catch (error) {
      this.logger.error(
        `Failed to fetch news from CryptoCompare: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      return [];
    }
  }
}
