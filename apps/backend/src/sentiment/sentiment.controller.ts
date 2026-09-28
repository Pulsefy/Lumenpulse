import {
  Controller,
  Get,
  Post,
  Body,
  HttpException,
  HttpStatus,
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
} from './sentiment.service';

export class AnalyzeDto {
  @ApiProperty({
    description: 'The text to run sentiment analysis on',
    example: 'Lumenpulse is doing great!',
  })
  text: string;
}

export class SentimentResponseDto implements SentimentResponse {
  @ApiProperty({
    description: 'Calculated sentiment polarity score between -1 and 1',
    example: 0.85,
  })
  sentiment: number;
}

export class HealthResponseDto implements HealthResponse {
  @ApiProperty({ description: 'Service health status', example: 'healthy' })
  status: string;

  @ApiProperty({
    description: 'Timestamp of health check',
    example: '2026-05-27T20:58:35Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Service name identifier',
    example: 'sentiment-analysis',
  })
  service: string;
}

@ApiTags('sentiment')
@Controller('sentiment')
export class SentimentController {
  constructor(private readonly sentimentService: SentimentService) {}

  @Post('analyze')
  @ApiOperation({
    summary: 'Analyze text sentiment polarity',
    description: 'Submits text to calculate polarity scores.',
  })
  @ApiResponse({
    status: 200,
    description: 'Sentiment calculated successfully',
    type: SentimentResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request (text empty)' })
  @ApiResponse({ status: 503, description: 'Sentiment service unavailable' })
  async analyzeSentiment(
    @Body() analyzeDto: AnalyzeDto,
  ): Promise<SentimentResponse> {
    if (!analyzeDto || analyzeDto.text === undefined || analyzeDto.text === null) {
      throw new HttpException('Text cannot be empty', HttpStatus.BAD_REQUEST);
    }
    return this.sentimentService.analyzeSentiment(analyzeDto.text);
  }

  @Get('health')
  @ApiOperation({
    summary: 'Check sentiment service health status',
    description: 'Checks health of sentiment analysis service.',
  })
  @ApiResponse({
    status: 200,
    description: 'Sentiment service health retrieved successfully',
    type: HealthResponseDto,
  })
  @ApiResponse({ status: 503, description: 'Sentiment service unavailable' })
  async checkSentimentHealth(): Promise<HealthResponse> {
    return this.sentimentService.checkHealth();
  }
}
