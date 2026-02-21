import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';

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

interface PythonApiErrorResponse {
  detail?: string;
  [key: string]: unknown;
}

interface HttpErrorResponse {
  data?: PythonApiErrorResponse;
  status?: number;
}

// Helper function to check if an error is an AxiosError
function isAxiosError(error: unknown): error is AxiosError {
  return (
    error instanceof AxiosError ||
    (typeof error === 'object' &&
      error !== null &&
      'isAxiosError' in error &&
      (error as { isAxiosError?: boolean }).isAxiosError === true)
  );
}

// Helper function to check if error has response data
function hasResponseData(
  error: unknown,
): error is { response?: HttpErrorResponse } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: unknown }).response === 'object'
  );
}

// Helper function to check if error has code property
function hasErrorCode(error: unknown): error is { code?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

@Injectable()
export class SentimentService {
  private readonly logger = new Logger(SentimentService.name);
  private readonly pythonApiUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    // Get Python API URL from environment or use default
    this.pythonApiUrl = this.configService.get<string>(
      'PYTHON_API_URL',
      'http://localhost:8000',
    );
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

      const response = await firstValueFrom(
        this.httpService.post<SentimentResponse>(
          `${this.pythonApiUrl}/analyze`,
          request,
          {
            timeout: 10000, // 10 second timeout
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      this.logger.debug(`Received sentiment score: ${response.data.sentiment}`);
      return response.data;
    } catch (error: unknown) {
      // Check for AxiosError first (including mocked ones)
      if (isAxiosError(error) || hasResponseData(error)) {
        const axiosError = error as AxiosError<PythonApiErrorResponse>;
        const errorMessage = axiosError.message || 'Unknown Axios error';
        const errorStack = axiosError.stack || 'No stack trace available';

        this.logger.error(
          `Failed to analyze sentiment: ${errorMessage}`,
          errorStack,
        );

        if (axiosError.response?.data) {
          const errorDetail =
            axiosError.response.data.detail || 'Unknown error';
          const statusCode =
            axiosError.response.status || HttpStatus.INTERNAL_SERVER_ERROR;

          throw new HttpException(
            `Python API error: ${errorDetail}`,
            statusCode,
          );
        }

        if (
          hasErrorCode(error) &&
          (error.code === 'ECONNREFUSED' || error.code === 'ECONNABORTED')
        ) {
          throw new HttpException(
            'Python sentiment service is unavailable',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }

        throw new HttpException(
          `Failed to analyze sentiment: ${errorMessage}`,
          // (axiosError as { status?: number }).status || HttpStatus.INTERNAL_SERVER_ERROR,
          axiosError.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
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
      const response = await firstValueFrom(
        this.httpService.get<HealthResponse>(`${this.pythonApiUrl}/health`, {
          timeout: 5000,
        }),
      );
      return response.data;
    } catch (error: unknown) {
      if (isAxiosError(error) || error instanceof Error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
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
