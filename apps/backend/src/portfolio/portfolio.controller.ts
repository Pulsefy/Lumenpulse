import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { PortfolioService } from './portfolio.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  GetPortfolioHistoryDto,
  PortfolioHistoryResponseDto,
} from './dto/portfolio-snapshot.dto';
import {
  GetPortfolioSummaryQueryDto,
  PortfolioSummaryWithCurrencyResponseDto,
  CurrencyCode,
} from './dto/portfolio-currency.dto';
import { PortfolioPerformanceResponseDto } from './dto/portfolio-performance.dto';
import {
  getPortfolioReadThrottleOverride,
  getPortfolioWriteThrottleOverride,
} from '../common/rate-limit/rate-limit.config';

@ApiTags('portfolio')
@ApiBearerAuth('JWT-auth')
@Controller('portfolio')
@UseGuards(JwtAuthGuard)
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get('summary')
  @Throttle(getPortfolioReadThrottleOverride())
  @ApiOperation({
    summary: 'Get portfolio summary',
    description:
      'Returns the latest portfolio snapshot with total value in specified currency and individual asset balances',
  })
  @ApiQuery({
    name: 'currency',
    required: false,
    enum: CurrencyCode,
    description: 'Target currency for portfolio valuation (default: USD)',
  })
  @ApiResponse({
    status: 200,
    description: 'Portfolio summary retrieved successfully',
    type: PortfolioSummaryWithCurrencyResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPortfolioSummary(
    @Request() req: any,
    @Query() query: GetPortfolioSummaryQueryDto,
  ): Promise<PortfolioSummaryWithCurrencyResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    const currency = query.currency || CurrencyCode.USD;
    return this.portfolioService.getPortfolioSummaryInCurrency(
      userId,
      currency,
    );
  }

  @Get('history')
  @Throttle(getPortfolioReadThrottleOverride())
  @ApiOperation({
    summary: 'Get portfolio history',
    description:
      'Returns portfolio snapshots for the authenticated user with pagination',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({
    status: 200,
    description: 'Portfolio history retrieved successfully',
    type: PortfolioHistoryResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPortfolioHistory(
    @Request() req: any,
    @Query() query: GetPortfolioHistoryDto,
  ): Promise<PortfolioHistoryResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string; // Extract user ID from JWT
    return this.portfolioService.getPortfolioHistory(
      userId,
      query.page,
      query.limit,
    );
  }

  @Post('snapshot')
  @Throttle(getPortfolioWriteThrottleOverride())
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create portfolio snapshot',
    description:
      'Manually trigger snapshot creation for the authenticated user',
  })
  @ApiResponse({
    status: 201,
    description: 'Snapshot created successfully',
    schema: {
      properties: {
        success: { type: 'boolean', example: true },
        snapshot: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              example: '123e4567-e89b-12d3-a456-426614174000',
            },
            createdAt: { type: 'string', format: 'date-time' },
            totalValueUsd: { type: 'string', example: '15420.50' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createSnapshot(@Request() req: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    const snapshot = await this.portfolioService.createSnapshot(userId);
    return {
      success: true,
      snapshot: {
        id: snapshot.id,
        createdAt: snapshot.createdAt,
        totalValueUsd: snapshot.totalValueUsd,
      },
    };
  }

  @Post('snapshots/trigger')
  @Throttle(getPortfolioWriteThrottleOverride())
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trigger snapshot creation for all users (Admin)',
    description:
      'Manually trigger snapshot creation for all users. In production, this should be protected with admin guard',
  })
  @ApiResponse({
    status: 200,
    description: 'Snapshot creation triggered',
    schema: {
      properties: {
        message: { type: 'string', example: 'Snapshot creation triggered' },
        success: { type: 'number', example: 42 },
        failed: { type: 'number', example: 0 },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async triggerSnapshotCreation() {
    const result = await this.portfolioService.triggerSnapshotCreation();
    return {
      message: 'Snapshot creation triggered',
      success: result.success,
      failed: result.failed,
    };
  }

  @Get('performance')
  @Throttle(getPortfolioReadThrottleOverride())
  @ApiOperation({
    summary: 'Get portfolio performance',
    description:
      'Returns portfolio performance metrics (24h, 7d, 30d) for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Portfolio performance retrieved successfully',
    type: PortfolioPerformanceResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPortfolioPerformance(
    @Request() req: any,
  ): Promise<PortfolioPerformanceResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.portfolioService.getPortfolioPerformance(userId);
  }

  @Get('allocation')
  @Throttle(getPortfolioReadThrottleOverride())
  @ApiOperation({
    summary: 'Get portfolio asset allocation',
    description:
      'Returns the asset allocation breakdown across all linked accounts for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Asset allocation retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAssetAllocation(@Request() req: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.portfolioService.getAssetAllocation(userId);
  }
}
