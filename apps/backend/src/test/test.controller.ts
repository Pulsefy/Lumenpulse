import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

@Controller('test')
export class TestController {
  private rateLimitTestCount = 0;
  
  @Get('hello')
  getHello(): string {
    return 'Hello World!';
  }

  @Post('submit')
  submitData(@Body() body: Record<string, unknown>): {
    message: string;
    timestamp: Date;
    receivedData?: Record<string, unknown>;
  } {
    return {
      message: 'Data submitted successfully',
      timestamp: new Date(),
      receivedData: body,
    };
  }

  @Get('error')
  getError(): void {
    throw new Error('Test error for logging');
  }

  @Get('not-found')
  getNotFound(): void {
    throw new Error('Resource not found');
  }

  @Get('redirect')
  getRedirect(): Record<string, unknown> {
    return { redirect: true, destination: '/test/hello' };
  }

  @Put('update/:id')
  updateData(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): { message: string; id: string; updatedData: Record<string, unknown> } {
    return {
      message: 'Data updated successfully',
      id,
      updatedData: body,
    };
  }

  @Delete('delete/:id')
  deleteData(@Param('id') id: string): { message: string; id: string } {
    return {
      message: 'Data deleted successfully',
      id,
    };
  }

  // ============================================
  // RATE LIMITING TEST ENDPOINTS
  // ============================================
  
  @Get('rate-limit-test')
  testRateLimit() {
    this.rateLimitTestCount++;
    return {
      success: true,
      message: `Rate limit test request #${this.rateLimitTestCount}`,
      timestamp: new Date().toISOString(),
      note: 'This endpoint is rate limited (3 requests per minute)',
      instruction: 'Make 4 quick requests to see rate limiting in action'
    };
  }
  
  @SkipThrottle()
  @Get('rate-limit/unlimited')
  unlimitedRateLimit() {
    return {
      success: true,
      message: 'This endpoint has NO rate limiting',
      timestamp: new Date().toISOString(),
      note: 'Use @SkipThrottle() decorator to bypass rate limits'
    };
  }
  
  @Throttle(10, 60) // Custom limit: 10 requests per 60 seconds
  @Get('rate-limit/custom')
  customRateLimit() {
    return {
      success: true,
      message: 'Custom rate limit: 10 requests per minute',
      timestamp: new Date().toISOString(),
      note: 'Uses @Throttle(10, 60) decorator'
    };
  }
  
  @Get('rate-limit/info')
  getRateLimitInfo() {
    return {
      success: true,
      message: 'Rate Limiting Information',
      timestamp: new Date().toISOString(),
      configuration: {
        defaultLimit: '3 requests per minute (for testing)',
        configurableVia: 'Environment variables (.env)',
        envVariables: {
          RATE_LIMIT_MAX_REQUESTS: 'Maximum requests per time window',
          RATE_LIMIT_TTL: 'Time window in milliseconds (default: 60000 = 1 minute)'
        },
        productionDefault: '100 requests per minute',
        errorCode: '429 Too Many Requests'
      }
    };
  }
}