import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { WarmCachePreloaderService } from './warm-cache-preloader.service';
import { WarmCacheReport } from './warm-cache.registry';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';

class ForceRefreshDto {
  /** Optional identifier for audit logs. */
  requestedBy?: string;
}

@ApiTags('cache')
@Controller('cache')
export class WarmCacheController {
  private readonly logger = new Logger(WarmCacheController.name);

  constructor(
    private readonly preloaderService: WarmCachePreloaderService,
  ) {}

  /**
   * POST /cache/warm
   *
   * Immediately preloads all registered hot-cache routes.
   * Restricted to ADMIN role.
   */
  @Post('warm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually trigger a warm-cache preload cycle',
    description:
      'Preloads all registered hot-cache routes immediately. ' +
      'Skips if Redis is unhealthy. Restricted to ADMIN role.',
  })
  @ApiBody({ type: ForceRefreshDto, required: false })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Warm-cache refresh report.',
  })
  async forceRefresh(
    @Body() dto?: ForceRefreshDto,
  ): Promise<WarmCacheReport> {
    this.logger.log(
      `Manual cache warm triggered by: ${dto?.requestedBy ?? 'unknown'}`,
    );
    return this.preloaderService.forceRefresh(dto?.requestedBy);
  }

  /**
   * GET /cache/warm/status
   *
   * Returns the most recent warm-cache refresh report without triggering a new cycle.
   * Restricted to ADMIN role.
   */
  @Get('warm/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get the last warm-cache refresh report',
    description:
      'Returns the result of the most recently completed preload cycle, ' +
      'or null if no cycle has run yet.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Last warm-cache report (or null if never run).',
  })
  getStatus(): { lastRunAt: string | null; report: WarmCacheReport | null } {
    return {
      lastRunAt: this.preloaderService.getLastRunAt(),
      report: this.preloaderService.getLastReport(),
    };
  }
}
