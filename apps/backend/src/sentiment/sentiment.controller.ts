import {
  Controller,
  Post,
  Get,
  Body,
  UsePipes,
  ValidationPipe,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import {
  SentimentService,
  SentimentResponse,
  HealthResponse,
} from './sentiment.service';
import { IsNotEmpty, IsString } from 'class-validator';

class SentimentRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'Text cannot be empty' })
  text: string;
}

@ApiTags('sentiment')
@Controller('sentiment')
export class SentimentController {
  constructor(private readonly sentimentService: SentimentService) {}

  @Post('analyze')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Analyze sentiment of provided text' })
  @ApiBody({ type: SentimentRequestDto })
  @ApiResponse({ status: 201, description: 'Sentiment analysis successful' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({
    status: 503,
    description: 'Python sentiment service unavailable',
  })
  @UsePipes(new ValidationPipe({ transform: true }))
  async analyzeSentiment(
    @Body() sentimentRequest: SentimentRequestDto,
  ): Promise<SentimentResponse> {
    return this.sentimentService.analyzeSentiment(sentimentRequest.text);
  }

  @Get('health')
  @ApiOperation({ summary: 'Check health of Python sentiment service' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  async checkHealth(): Promise<HealthResponse> {
    return this.sentimentService.checkHealth();
  }
}
