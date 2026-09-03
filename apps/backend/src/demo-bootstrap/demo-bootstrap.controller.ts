import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { GetUser, Roles } from '../auth/decorators/auth.decorators';
import { User, UserRole } from '../users/entities/user.entity';
import {
  BootstrapRunKind,
  BootstrapRunStatus,
} from '../bootstrap-runs/entities/bootstrap-run.entity';
import { BootstrapTeardownService } from './bootstrap-teardown.service';
import { DemoBootstrapService } from './demo-bootstrap.service';
import {
  BootstrapRunSummaryDto,
  BootstrapTeardownResultDto,
  TeardownBootstrapRunDto,
} from './dto/bootstrap-teardown.dto';
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
 *  6. Undo one specific run (preview first with dryRun):
 *       GET  /v1/demo-bootstrap/runs
 *       POST /v1/demo-bootstrap/runs/<run-id>/teardown  { "dryRun": true }
 */
@ApiTags('demo-bootstrap')
@Controller('demo-bootstrap')
export class DemoBootstrapController {
  private readonly logger = new Logger(DemoBootstrapController.name);

  constructor(
    private readonly svc: DemoBootstrapService,
    private readonly teardownSvc: BootstrapTeardownService,
  ) {}

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
  seed(
    @Body() dto: SeedDemoDto,
    @GetUser() user: User,
  ): Promise<SeedResultDto> {
    const scenario = dto.scenario ?? DemoScenario.FULL;
    const resetBeforeSeed = dto.resetBeforeSeed ?? true;
    this.logger.log(
      `Admin ${user.id} requested demo seed: scenario=${scenario}`,
    );
    return this.svc.seed(scenario, resetBeforeSeed, user.id);
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

  @Get('runs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'List recorded bootstrap runs (admin only)',
    description:
      'Returns bootstrap runs newest-first with the identifier to pass to the ' +
      'teardown endpoint. Covers both demo seeds and Friendbot-funded testnet ' +
      'accounts. Resource identifiers are not included — fetch a teardown dry ' +
      'run to see exactly what a given run created.',
  })
  @ApiQuery({
    name: 'kind',
    required: false,
    enum: Object.values(BootstrapRunKind),
    description: 'Filter by what produced the run',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: Object.values(BootstrapRunStatus),
    description: 'Filter by run status',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum rows to return (default 50, max 200)',
  })
  @ApiResponse({
    status: 200,
    description: 'Recorded bootstrap runs',
    type: [BootstrapRunSummaryDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — admin JWT required',
  })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  listRuns(
    @Query('kind') kind?: BootstrapRunKind,
    @Query('status') status?: BootstrapRunStatus,
    @Query('limit') limit?: string,
  ): Promise<BootstrapRunSummaryDto[]> {
    const parsedLimit = Number.parseInt(limit ?? '', 10);

    return this.teardownSvc.listRuns({
      kind,
      status,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
  }

  @Post('runs/:runId/teardown')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Tear down one bootstrap run (admin only, testnet/development only)',
    description:
      'Removes the data created by a single bootstrap run, identified by its ' +
      'run id. Pass { "dryRun": true } to list what would be removed without ' +
      'changing anything. Refused with 403 unless the environment is explicitly ' +
      'marked as testnet (STELLAR_NETWORK=testnet) or development ' +
      '(NODE_ENV=development|test); never permitted in production. ' +
      'Safe to call repeatedly — a run that is already torn down reports so.',
  })
  @ApiParam({
    name: 'runId',
    description:
      'Run identifier returned by the seed/fund response or GET /runs',
  })
  @ApiResponse({
    status: 200,
    description: 'Teardown completed, or dry run listing what would be removed',
    type: BootstrapTeardownResultDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — admin JWT required',
  })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden — admin role required, or the environment is not marked as ' +
      'testnet or development',
  })
  @ApiResponse({
    status: 404,
    description: 'No bootstrap run with that identifier',
  })
  teardownRun(
    @Param('runId') runId: string,
    @Body() dto: TeardownBootstrapRunDto,
    @GetUser() user: User,
  ): Promise<BootstrapTeardownResultDto> {
    const dryRun = dto.dryRun ?? false;
    this.logger.log(
      `Admin ${user.id} requested bootstrap teardown for run ${runId} (dryRun=${dryRun})`,
    );

    return this.teardownSvc.teardown(runId, {
      dryRun,
      requestedBy: user.id,
    });
  }
}
