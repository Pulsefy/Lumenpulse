import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { Throttle } from '@nestjs/throttler';
import { getAnalyticsReadThrottleOverride } from '../common/rate-limit/rate-limit.config';
import { ReviewMetricsService } from './review-metrics.service';
import {
  ReviewMetricsQueryDto,
  ReviewMetricsResponseDto,
} from './dto/review-metrics.dto';

@ApiTags('review metrics')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('review-metrics')
@Throttle(getAnalyticsReadThrottleOverride())
export class ReviewMetricsController {
  constructor(private readonly reviewMetricsService: ReviewMetricsService) {}

  @Get('aging')
  @ApiOperation({
    summary: 'Get review aging metrics',
    description:
      'Returns aging distribution and latency statistics for pending/in-review items ' +
      'across moderation reports and portfolio anomalies. Requires admin role.',
  })
  @ApiResponse({
    status: 200,
    description: 'Aging metrics computed successfully',
    type: ReviewMetricsResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden – admin role required' })
  async getAgingMetrics(
    @Query() query: ReviewMetricsQueryDto,
  ): Promise<ReviewMetricsResponseDto> {
    return this.reviewMetricsService.getReviewMetrics(query);
  }
}
