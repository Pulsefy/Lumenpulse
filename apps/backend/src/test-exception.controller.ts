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
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiProperty,
} from '@nestjs/swagger';
import {
  SentimentService,
  SentimentResponse,
  HealthResponse,
} from './sentiment/sentiment.service';
import { config } from './lib/config';

// DTO for sentiment analysis
class AnalyzeDto {
  @ApiProperty({
    description: 'The text to run sentiment analysis on',
    example: 'Lumenpulse is doing great!',
  })
  text: string;
}

// Interface for test results
class SentimentTestCaseDto {
  @ApiProperty({
    description: 'Test text analyzed',
    example: 'I love this product!',
  })
  text: string;

  @ApiProperty({ description: 'Sentiment score returned', example: 0.85 })
  sentiment?: number;

  @ApiProperty({ description: 'Expected class', example: 'positive' })
  expected: string;

  @ApiProperty({ description: 'Test status', example: 'success' })
  status: string;

  @ApiProperty({ description: 'Actual class calculated', example: 'positive' })
  actual?: string;

  @ApiProperty({
    description: 'Whether actual matches expected',
    example: true,
  })
  match?: boolean;

  @ApiProperty({ description: 'Error message if failed', example: '' })
  error?: string;
}

class SentimentTestResultDto {
  @ApiProperty({
    description: 'ISO timestamp of the run',
    example: '2026-05-27T21:00:00Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Status of testing process',
    example: 'complete',
  })
  status: string;

  @ApiProperty({
    description: 'Status feedback message',
    example: 'All tests finished',
  })
  message?: string;

  @ApiProperty({ description: 'Total count of tests executed', example: 3 })
  totalTests: number;

  @ApiProperty({ description: 'Count of successful requests', example: 3 })
  successful: number;

  @ApiProperty({ description: 'Count of matching classifications', example: 3 })
  matches: number;

  @ApiProperty({
    description: 'Run details for each test case',
    type: [SentimentTestCaseDto],
  })
  testCases: SentimentTestCaseDto[];

  @ApiProperty({
    description: 'Target Python API URL',
    example: 'http://localhost:8000',
  })
  pythonApiUrl: string;

  @ApiProperty({ description: 'Availability of Python service', example: true })
  serviceAvailable: boolean;
}

class ExceptionTestResultDto {
  @ApiProperty({
    description: 'Name of the test endpoint',
    example: 'http-exception',
  })
  endpoint: string;

  @ApiProperty({
    description: 'URL path of endpoint',
    example: 'test-exception/http-exception',
  })
  url: string;

  @ApiProperty({
    description: 'Current availability/status',
    example: 'available',
  })
  status: string;
}

class AllTestsSummaryDto {
  @ApiProperty({ description: 'Total exception endpoints tested', example: 3 })
  totalExceptionTests: number;

  @ApiProperty({
    description: 'Availability of sentiment service',
    example: true,
  })
  sentimentServiceAvailable: boolean;

  @ApiProperty({
    description: 'Overall combined status string',
    example: 'full_service',
  })
  overallStatus: string;
}

class AllTestsResultDto {
  @ApiProperty({
    description: 'Timestamp of run',
    example: '2026-05-27T21:00:00Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Results of exception tests',
    type: [ExceptionTestResultDto],
  })
  exceptionTests: ExceptionTestResultDto[];

  @ApiProperty({
    description: 'Results of sentiment tests',
    type: SentimentTestResultDto,
    nullable: true,
  })
  sentimentTests: SentimentTestResultDto | null;

  @ApiProperty({
    description: 'Overall run summary metrics',
    type: AllTestsSummaryDto,
  })
  summary: AllTestsSummaryDto;
}

class SentimentResponseDto implements SentimentResponse {
  @ApiProperty({
    description: 'Calculated sentiment polarity score between -1 and 1',
    example: 0.85,
  })
  sentiment: number;

  @ApiProperty({ description: 'Classification category', example: 'positive' })
  label: string;
}

class HealthResponseDto implements HealthResponse {
  @ApiProperty({ description: 'Service health status', example: 'healthy' })
  status: string;

  @ApiProperty({
    description: 'Timestamp of health check',
    example: '2026-05-27T20:58:35Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Service name identifier',
    example: 'sentiment-analysis-service',
  })
  service: string;
}

@ApiTags('test-exception')
@Controller('test-exception')
export class TestExceptionController {
  private readonly logger = new Logger(TestExceptionController.name);

  constructor(private readonly sentimentService?: SentimentService) {}

  // ===== Original Exception Testing Endpoints (Backward Compatible) =====

  @Get('http-exception')
  @ApiOperation({
    summary: 'Trigger standard HTTP HttpException',
    description:
      'Throws a BAD_REQUEST HttpException to test exception filters.',
  })
  @ApiResponse({ status: 400, description: 'Throws a Bad Request exception' })
  getHttpException() {
    throw new HttpException(
      'Test HTTP exception message',
      HttpStatus.BAD_REQUEST,
    );
  }

  @Get('general-error')
  @ApiOperation({
    summary: 'Trigger standard Javascript Error',
    description:
      'Throws a generic Error to test internal server error mappings.',
  })
  @ApiResponse({ status: 500, description: 'Throws generic Error' })
  getGeneralError() {
    throw new Error('Test general error message');
  }

  @Get('internal-server-error')
  @ApiOperation({
    summary: 'Trigger unknown error type',
    description:
      'Throws an Error with unknown details to verify fallback logs.',
  })
  @ApiResponse({ status: 500, description: 'Throws unknown error type' })
  getInternalServerError() {
    // This will trigger the unknown error path
    throw new Error('Unknown error type');
  }

  // ===== New Sentiment Analysis Endpoints =====

  @Post('sentiment/analyze')
  @ApiOperation({
    summary: 'Analyze text sentiment polarity',
    description:
      'Submits text to the Python data service to calculate polarity scores.',
  })
  @ApiResponse({
    status: 200,
    description: 'Sentiment calculated successfully',
    type: SentimentResponseDto,
  })
  @ApiResponse({ status: 503, description: 'Sentiment service unavailable' })
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
  @ApiOperation({
    summary: 'Check sentiment service health status',
    description:
      'Pings the underlying Python analysis service health endpoint.',
  })
  @ApiResponse({
    status: 200,
    description: 'Sentiment service health retrieved successfully',
    type: HealthResponseDto,
  })
  @ApiResponse({ status: 503, description: 'Sentiment service unavailable' })
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
  @ApiOperation({
    summary: 'Run sentiment test suite',
    description:
      'Runs multiple hardcoded test phrases to verify sentiment classifications.',
  })
  @ApiResponse({
    status: 200,
    description: 'Test suite ran successfully',
    type: SentimentTestResultDto,
  })
  async testSentiment(): Promise<SentimentTestResultDto> {
    if (!this.sentimentService) {
      return {
        timestamp: new Date().toISOString(),
        status: 'service_unavailable',
        message: 'Sentiment service is not configured',
        totalTests: 0,
        successful: 0,
        matches: 0,
        testCases: [],
        pythonApiUrl: config.python.apiUrl,
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

    const results: SentimentTestCaseDto[] = [];

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
      pythonApiUrl: config.python.apiUrl,
      serviceAvailable: true,
    };
  }

  // ===== Hybrid Endpoint for Testing Both =====

  @Get('all-tests')
  @ApiOperation({
    summary: 'Run exception filters and sentiment tests together',
    description:
      'Bundles diagnostics for both exceptions filters and sentiment APIs.',
  })
  @ApiResponse({
    status: 200,
    description: 'All tests finished successfully',
    type: AllTestsResultDto,
  })
  async runAllTests(): Promise<AllTestsResultDto> {
    const results: AllTestsResultDto = {
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
          pythonApiUrl: config.python.apiUrl,
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
