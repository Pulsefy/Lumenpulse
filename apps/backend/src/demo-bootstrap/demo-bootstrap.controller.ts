import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { DemoBootstrapService } from './demo-bootstrap.service';
import {
  SeedDemoDto,
  SeedResultDto,
  ResetResultDto,
  BootstrapStatusDto,
  DemoScenario,
} from './dto/demo-bootstrap.dto';

/**
 * DemoBootstrapController
 *
 * Safe bootstrap endpoints for seeding demo-friendly testnet scenarios.
 *
 * Environment gate:
 *  - All endpoints return 503 Service Unavailable unless:
 *      STELLAR_NETWORK=testnet AND BOOTSTRAP_DEMO_DATA_ENABLED=true
 *
 * Authorization:
 *  - Mutating endpoints (seed, reset) require admin JWT.
 *  - Status endpoint is public (read-only).
 *
 * Usage (maintainer guide):
 *  1. Ensure .env.local has:
 *       STELLAR_NETWORK=testnet
 *       BOOTSTRAP_DEMO_DATA_ENABLED=true
 *  2. Start the backend and authenticate as admin to obtain a JWT.
 *  3. Seed a full demo scenario:
 *       POST /v1/demo-bootstrap/seed
 *       Authorization: Bearer <admin-jwt>
 *       Body: { "scenario": "full" }
 *  4. Check status:
 *       GET /v1/demo-bootstrap/status
 *  5. Reset seeded data:
 *       POST /v1/demo-bootstrap/reset
 *       Authorization: Bearer <admin-jwt>
 */
@ApiTags('demo-bootstrap')
@Controller('demo-bootstrap')
export class DemoBootstrapController {
  private readonly logger = new Logger(DemoBootstrapController.name);

  constructor(private readonly svc: DemoBootstrapService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Get demo bootstrap status',
    description:
      'Returns whether demo bootstrap is enabled, the current network, ' +
      'and whether demo data has been seeded. This endpoint is public.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current bootstrap status',
    type: BootstrapStatusDto,
  })
  getStatus(): BootstrapStatusDto {
    return this.svc.getStatus();
  }

  @Post('seed')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Seed demo testnet data (admin only, testnet only)',
    description:
      'Seeds demo-friendly testnet scenarios for contributor review and MVP walkthroughs. ' +
      'Only available when STELLAR_NETWORK=testnet and BOOTSTRAP_DEMO_DATA_ENABLED=true. ' +
      'Safe to repeat — pass resetBeforeSeed=true (default) to clear previous state first.',
  })
  @ApiResponse({
    status: 200,
    description: 'Demo data seeded successfully',
    type: SeedResultDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — admin JWT required',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — admin role required',
  })
  @ApiResponse({
    status: 503,
    description:
      'Demo bootstrap is disabled in this environment (not testnet or flag not set)',
  })
  seed(@Body() dto: SeedDemoDto): SeedResultDto {
    const scenario = dto.scenario ?? DemoScenario.FULL;
    const resetBeforeSeed = dto.resetBeforeSeed ?? true;
    this.logger.log(`Admin requested demo seed: scenario=${scenario}`);
    return this.svc.seed(scenario, resetBeforeSeed);
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Reset seeded demo data (admin only, testnet only)',
    description:
      'Clears all seeded demo data. Only available when STELLAR_NETWORK=testnet ' +
      'and BOOTSTRAP_DEMO_DATA_ENABLED=true. Safe to call when no data is seeded.',
  })
  @ApiResponse({
    status: 200,
    description: 'Demo data reset successfully',
    type: ResetResultDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — admin JWT required',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — admin role required',
  })
  @ApiResponse({
    status: 503,
    description:
      'Demo bootstrap is disabled in this environment (not testnet or flag not set)',
  })
  reset(): ResetResultDto {
    this.logger.log('Admin requested demo data reset');
    return this.svc.reset();
  }
}
