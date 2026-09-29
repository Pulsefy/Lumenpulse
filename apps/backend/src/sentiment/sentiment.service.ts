import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import {
  DataProcessingClientError,
  DataProcessingClientService,
} from '../data-processing/data-processing-client.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { config } from '../lib/config';
import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
} from '../common/constants/request.constants';
import { RequestContextService } from '../common/services/request-context.service';

export interface SentimentRequest {
  text: string;
}

export interface SentimentResponse {
  sentiment: number; // -1 to 1
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  service: string;
}

@Injectable()
export class SentimentService {
  private readonly logger = new Logger(SentimentService.name);

  constructor(private readonly dataProcessing: DataProcessingClientService) {}
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    // Get Python API URL from environment or configuration
    this.pythonApiUrl =
      this.configService.get<string>('PYTHON_API_URL') || config.python.apiUrl;
    this.logger.log(`Python API URL: ${this.pythonApiUrl}`);
  }

  async analyzeSentiment(text: string): Promise<SentimentResponse> {
    try {
      if (!text || text.trim().length === 0) {
        throw new HttpException('Text cannot be empty', HttpStatus.BAD_REQUEST);
      }

      const request: SentimentRequest = { text };

      this.logger.debug(
        `Sending sentiment analysis request for text: "${text.substring(0, 50)}..."`,
      );

      const response = await this.dataProcessing.post<SentimentResponse>(
        '/analyze',
        request,
        { timeoutMs: 10_000 },
      const correlationId = RequestContextService.getCorrelationId();
      const requestId = RequestContextService.getRequestId();

      const response = await firstValueFrom(
        this.httpService.post<SentimentResponse>(
          `${this.pythonApiUrl}/analyze`,
          request,
          {
            timeout: 10000, // 10 second timeout
            headers: {
              'Content-Type': 'application/json',
              [CORRELATION_ID_HEADER]: correlationId,
              [REQUEST_ID_HEADER]: requestId,
            },
          },
        ),
      );

      this.logger.debug(`Received sentiment score: ${response.data.sentiment}`);
      return response.data;
    } catch (error: unknown) {
      if (error instanceof DataProcessingClientError) {
        this.logger.error(
          `Failed to analyze sentiment: ${error.message}`,
          error.stack,
        );

        if (error.code === 'CIRCUIT_OPEN') {
          throw error;
        }

        if (error.getStatus() === HttpStatus.SERVICE_UNAVAILABLE) {
          throw new HttpException(
            'Python sentiment service is unavailable',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }

        const responseData = error.responseData as { detail?: string } | undefined;
        throw new HttpException(
          `Python API error: ${responseData?.detail || error.message}`,
          error.getStatus(),
        );
      } else if (error instanceof HttpException) {
        // Re-throw HttpException as-is
        throw error;
      } else if (error instanceof Error) {
        this.logger.error(
          `Failed to analyze sentiment: ${error.message}`,
          error.stack,
        );
        throw new HttpException(
          `Failed to analyze sentiment: ${error.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      } else {
        this.logger.error(
          'Unknown error occurred during sentiment analysis',
          JSON.stringify(error),
        );
        throw new HttpException(
          'Unknown error occurred',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  }
  async checkHealth(): Promise<HealthResponse> {
    try {
      return await this.dataProcessing.get<HealthResponse>('/health', {
        timeoutMs: 5_000,
      });
      const correlationId = RequestContextService.getCorrelationId();
      const requestId = RequestContextService.getRequestId();
      const response = await firstValueFrom(
        this.httpService.get<HealthResponse>(`${this.pythonApiUrl}/health`, {
          timeout: 5000,
          headers: {
            [CORRELATION_ID_HEADER]: correlationId,
            [REQUEST_ID_HEADER]: requestId,
          },
        }),
      );
      return response.data;
    } catch (error: unknown) {
      if (
        error instanceof DataProcessingClientError &&
        error.code === 'CIRCUIT_OPEN'
      ) {
        throw error;
      }
      if (error instanceof Error) {
        const errorMessage =
          error.message || 'Unknown error';
        this.logger.warn(`Python API health check failed: ${errorMessage}`);
        throw new HttpException(
          'Python sentiment service is unhealthy',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      } else {
        this.logger.warn(
          'Unknown error during health check',
          JSON.stringify(error),
        );
        throw new HttpException(
          'Python sentiment service is unhealthy',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }
  }
}
