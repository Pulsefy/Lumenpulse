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
import { PortfolioService } from './portfolio.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  GetPortfolioHistoryDto,
  PortfolioHistoryResponseDto,
} from './dto/portfolio-snapshot.dto';
import { PortfolioPerformanceResponseDto } from './dto/portfolio-performance.dto';

@Controller('portfolio')
@UseGuards(JwtAuthGuard)
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  /**
   * GET /portfolio/history
   * Returns portfolio snapshots for the authenticated user with pagination
   */
  @Get('history')
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

  /**
   * POST /portfolio/snapshot
   * Manually trigger snapshot creation for the authenticated user
   */
  @Post('snapshot')
  @HttpCode(HttpStatus.CREATED)
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

  /**
   * POST /portfolio/snapshots/trigger
   * Admin endpoint to manually trigger snapshot creation for all users
   * In production, this should be protected with admin guard
   */
  @Post('snapshots/trigger')
  @HttpCode(HttpStatus.OK)
  async triggerSnapshotCreation() {
    const result = await this.portfolioService.triggerSnapshotCreation();
    return {
      message: 'Snapshot creation triggered',
      success: result.success,
      failed: result.failed,
    };
  }

  /**
   * GET /portfolio/performance
   * Returns portfolio performance metrics (24h, 7d, 30d) for the authenticated user
   */
  @Get('performance')
  async getPortfolioPerformance(
    @Request() req: any,
  ): Promise<PortfolioPerformanceResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.portfolioService.getPortfolioPerformance(userId);
  }
}
