import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Body,
  Logger,
} from '@nestjs/common';
import {
  SentimentService,
  SentimentResponse,
  HealthResponse,
} from './sentiment/sentiment.service';

// DTO for sentiment analysis
interface AnalyzeDto {
  text: string;
}

// Interface for test results
interface SentimentTestCase {
  text: string;
  sentiment?: number;
  expected: string;
  status: string;
  actual?: string;
  match?: boolean;
  error?: string;
}

interface SentimentTestResult {
  timestamp: string;
  status: string;
  message?: string;
  totalTests: number;
  successful: number;
  matches: number;
  testCases: SentimentTestCase[];
  pythonApiUrl: string;
  serviceAvailable: boolean;
}

interface ExceptionTestResult {
  endpoint: string;
  url: string;
  status: string;
}

interface AllTestsResult {
  timestamp: string;
  exceptionTests: ExceptionTestResult[];
  sentimentTests: SentimentTestResult | null;
  summary: {
    totalExceptionTests: number;
    sentimentServiceAvailable: boolean;
    overallStatus: string;
  };
}

@Controller('test-exception')
export class TestExceptionController {
  private readonly logger = new Logger(TestExceptionController.name);

  constructor(private readonly sentimentService?: SentimentService) {}

  // ===== Original Exception Testing Endpoints (Backward Compatible) =====

  @Get('http-exception')
  getHttpException() {
    throw new HttpException(
      'Test HTTP exception message',
      HttpStatus.BAD_REQUEST,
    );
  }

  @Get('general-error')
  getGeneralError() {
    throw new Error('Test general error message');
  }

  @Get('internal-server-error')
  getInternalServerError() {
    // This will trigger the unknown error path
    throw new Error('Unknown error type');
  }

  // ===== New Sentiment Analysis Endpoints =====

  @Post('sentiment/analyze')
  async analyzeSentiment(
    @Body() analyzeDto: AnalyzeDto,
  ): Promise<SentimentResponse> {
    if (!this.sentimentService) {
      throw new HttpException(
        'Sentiment service is not available',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    this.logger.log(
      `Analyzing sentiment for text: ${analyzeDto.text.substring(0, 50)}...`,
    );
    return this.sentimentService.analyzeSentiment(analyzeDto.text);
  }

  @Get('sentiment/health')
  async checkSentimentHealth(): Promise<HealthResponse> {
    if (!this.sentimentService) {
      throw new HttpException(
        'Sentiment service is not available',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return this.sentimentService.checkHealth();
  }

  @Post('sentiment/test')
  async testSentiment(): Promise<SentimentTestResult> {
    if (!this.sentimentService) {
      return {
        timestamp: new Date().toISOString(),
        status: 'service_unavailable',
        message: 'Sentiment service is not configured',
        totalTests: 0,
        successful: 0,
        matches: 0,
        testCases: [],
        pythonApiUrl: process.env.PYTHON_API_URL || 'http://localhost:8000',
        serviceAvailable: false,
      };
    }

    const testCases = [
      {
        text: 'I love this product! It is absolutely amazing!',
        expected: 'positive',
      },
      {
        text: 'This is terrible and awful, worst experience ever.',
        expected: 'negative',
      },
      { text: 'The weather is normal today.', expected: 'neutral' },
    ];

    const results: SentimentTestCase[] = [];

    for (const testCase of testCases) {
      try {
        const result = await this.sentimentService.analyzeSentiment(
          testCase.text,
        );

        const actual =
          result.sentiment > 0.05
            ? 'positive'
            : result.sentiment < -0.05
              ? 'negative'
              : 'neutral';

        const match =
          (result.sentiment > 0.05 && testCase.expected === 'positive') ||
          (result.sentiment < -0.05 && testCase.expected === 'negative') ||
          (result.sentiment >= -0.05 &&
            result.sentiment <= 0.05 &&
            testCase.expected === 'neutral');

        results.push({
          text:
            testCase.text.substring(0, 50) +
            (testCase.text.length > 50 ? '...' : ''),
          sentiment: result.sentiment,
          expected: testCase.expected,
          status: 'success',
          actual,
          match,
        });
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        results.push({
          text:
            testCase.text.substring(0, 50) +
            (testCase.text.length > 50 ? '...' : ''),
          expected: testCase.expected,
          status: 'failed',
          error: errorMessage,
        });
      }
    }

    const successCount = results.filter((r) => r.status === 'success').length;
    const matchCount = results.filter((r) => r.match).length;

    return {
      timestamp: new Date().toISOString(),
      status: successCount === testCases.length ? 'complete' : 'partial',
      totalTests: testCases.length,
      successful: successCount,
      matches: matchCount,
      testCases: results,
      pythonApiUrl: process.env.PYTHON_API_URL || 'http://localhost:8000',
      serviceAvailable: true,
    };
  }

  // ===== Hybrid Endpoint for Testing Both =====

  @Get('all-tests')
  async runAllTests(): Promise<AllTestsResult> {
    const results: AllTestsResult = {
      timestamp: new Date().toISOString(),
      exceptionTests: [],
      sentimentTests: null,
      summary: {
        totalExceptionTests: 0,
        sentimentServiceAvailable: false,
        overallStatus: '',
      },
    };

    // Test exception endpoints
    const exceptionEndpoints = [
      { name: 'http-exception', url: 'test-exception/http-exception' },
      { name: 'general-error', url: 'test-exception/general-error' },
      {
        name: 'internal-server-error',
        url: 'test-exception/internal-server-error',
      },
    ];

    for (const endpoint of exceptionEndpoints) {
      results.exceptionTests.push({
        endpoint: endpoint.name,
        url: endpoint.url,
        status: 'available',
      });
    }

    // Test sentiment if available
    if (this.sentimentService) {
      try {
        const sentimentTest = await this.testSentiment();
        results.sentimentTests = sentimentTest;
        results.summary.sentimentServiceAvailable = true;
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        results.sentimentTests = {
          timestamp: new Date().toISOString(),
          status: 'failed',
          message: `Sentiment test failed: ${errorMessage}`,
          totalTests: 0,
          successful: 0,
          matches: 0,
          testCases: [
            {
              text: 'Sentiment service test',
              expected: 'n/a',
              status: 'error',
              error: errorMessage,
            },
          ],
          pythonApiUrl: process.env.PYTHON_API_URL || 'http://localhost:8000',
          serviceAvailable: false,
        };
      }
    }

    results.summary.totalExceptionTests = exceptionEndpoints.length;
    results.summary.overallStatus = this.sentimentService
      ? 'full_service'
      : 'basic_service';

    return results;
  }
}
