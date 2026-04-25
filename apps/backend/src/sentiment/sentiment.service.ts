import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { catchError, map } from 'rxjs/operators';
import { firstValueFrom, of } from 'rxjs';
import { REQUEST_ID_HEADER } from '../common/constants/request.constants';
import { CorrelationService } from '../common/correlation/correlation.service';

@Injectable()
export class SentimentService {
  private readonly logger = new Logger(SentimentService.name);
  private readonly apiUrl = 'http://localhost:8000/analyze';

  constructor(
    private readonly httpService: HttpService,
    private readonly correlationService: CorrelationService,
  ) {}

  async analyzeSentiment(text: string): Promise<any> {
    const correlationId = this.correlationService.getCorrelationId();

    try {
      const response$ = this.httpService
        .post(
          this.apiUrl,
          { text },
          {
            timeout: 10000,
            headers: {
              'Content-Type': 'application/json',
              ...(correlationId && { [REQUEST_ID_HEADER]: correlationId }),
            },
          },
        )
        .pipe(
          map((res) => res.data),
          catchError((error) => {
            this.logger.error(
              `Sentiment analysis failed: ${error.message}`,
              error.stack,
            );
            return of({ sentiment: 0, error: true });
          }),
        );

      return await firstValueFrom(response$);
    } catch (error) {
      this.logger.error(`Error in sentiment service: ${error.message}`);
      return { sentiment: 0, error: true };
    }
  }
}
