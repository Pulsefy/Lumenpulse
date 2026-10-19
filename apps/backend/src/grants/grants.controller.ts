import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { GrantsService } from './grants.service';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit.config';
import {
  ApproveProjectDto,
  CreateRoundDto,
  FundPoolDto,
  RecordContributionDto,
  DistributeDto,
  RoundDto,
  RoundSummaryDto,
  RoundExportDto,
  LeaderboardQueryDto,
  LeaderboardResponseDto,
  RoundListQueryDto,
  RoundListResponseDto,
} from './dto/grants.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { AuditBlockchainAction } from '../admin-audit/decorators/audit-blockchain-action.decorator';
import { AdminAuditInterceptor } from '../admin-audit/interceptors/admin-audit.interceptor';

@ApiTags('grants')
@Controller('grants')
@RateLimitPolicy('projectRead')
export class GrantsController {
  constructor(private readonly grantsService: GrantsService) {}

  // Rounds

  @Get('rounds')
  @ApiOperation({
    summary: 'List all grant rounds',
    description: 'Retrieves all grant rounds and their lifecycle state.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of rounds retrieved successfully',
    type: RoundListResponseDto,
  })
  listRounds(@Query() query: RoundListQueryDto): RoundListResponseDto {
    return this.grantsService.listRounds(query);
  }

  @Get('rounds/:id')
  @ApiOperation({
    summary: 'Get details of a round',
    description:
      'Retrieves round details including token address and current pool balance.',
  })
  @ApiResponse({
    status: 200,
    description: 'Round details retrieved successfully',
    type: RoundDto,
  })
  @ApiResponse({ status: 404, description: 'Round not found' })
  getRound(@Param('id', ParseIntPipe) id: number) {
    return this.grantsService.getRound(id);
  }

  @Get('rounds/:id/summary')
  @ApiOperation({
    summary: 'Get round summary and allocations',
    description:
      'Retrieves a calculated summary of participation metrics and QF matching allocations.',
  })
  @ApiResponse({
    status: 200,
    description: 'Round summary retrieved successfully',
    type: RoundSummaryDto,
  })
  @ApiResponse({ status: 404, description: 'Round not found' })
  getRoundSummary(@Param('id', ParseIntPipe) id: number) {
    return this.grantsService.getRoundSummary(id);
  }

  @Get('rounds/:id/export')
  @ApiOperation({
    summary: 'Export round summary with detailed contributions list',
    description:
      'Retrieves a full export model of the round with all individual contributions listed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Round details exported successfully',
    type: RoundExportDto,
  })
  @ApiResponse({ status: 404, description: 'Round not found' })
  getRoundExport(@Param('id', ParseIntPipe) id: number) {
    return this.grantsService.getRoundExport(id);
  }

  @Post('rounds')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(AdminAuditInterceptor)
  @AuditBlockchainAction({ contractField: 'tokenAddress' })
  @ApiOperation({
    summary: 'Create a new grant round (admin only)',
    description:
      'Initializes a new grant round with start/end times and pool token. Requires admin role.',
  })
  @ApiResponse({
    status: 201,
    description: 'Round created successfully',
    type: RoundDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  createRound(@Body() dto: CreateRoundDto) {
    return this.grantsService.createRound(dto);
  }

  @Post('rounds/:id/finalize')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(AdminAuditInterceptor)
  @AuditBlockchainAction({ contractField: 'id' })
  @ApiOperation({
    summary: 'Finalize a grant round (admin only)',
    description:
      'Closes a round after matching is complete. Requires admin role.',
  })
  @ApiResponse({
    status: 200,
    description: 'Round finalized successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  @ApiResponse({ status: 404, description: 'Round not found' })
  finalizeRound(@Param('id', ParseIntPipe) id: number) {
    return this.grantsService.finalizeRound(id);
  }

  // Pool funding

  @Post('rounds/fund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(AdminAuditInterceptor)
  @AuditBlockchainAction({ contractField: 'funderPublicKey' })
  @ApiOperation({
    summary: 'Fund the matching pool (admin only)',
    description:
      'Records funding into the matching pool for a specific round. Requires admin role.',
  })
  @ApiResponse({
    status: 200,
    description: 'Matching pool funded successfully',
    schema: {
      type: 'object',
      properties: {
        roundId: { type: 'integer' },
        newBalance: { type: 'string' },
      },
      required: ['roundId', 'newBalance'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Matching pool funded successfully',
    schema: {
      type: 'object',
      properties: {
        roundId: { type: 'integer' },
        newBalance: { type: 'string' },
      },
      required: ['roundId', 'newBalance'],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  @ApiResponse({ status: 404, description: 'Round not found' })
  fundPool(@Body() dto: FundPoolDto) {
    return this.grantsService.fundPool(dto);
  }

  // Eligibility

  @Post('rounds/projects/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @UseInterceptors(AdminAuditInterceptor)
  @AuditBlockchainAction({ contractField: 'roundId' })
  @ApiOperation({
    summary: 'Approve a project for a round (admin/reviewer only)',
    description:
      'Approves project eligibility to receive match funding in the round. Requires admin or reviewer role.',
  })
  @ApiResponse({
    status: 200,
    description: 'Project approved successfully',
    schema: {
      type: 'object',
      properties: { success: { type: 'boolean' } },
      required: ['success'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Project approved successfully',
    schema: {
      type: 'object',
      properties: { success: { type: 'boolean' } },
      required: ['success'],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Round or project not found' })
  approveProject(@Body() dto: ApproveProjectDto) {
    this.grantsService.approveProject(dto);
    return { success: true };
  }

  @Delete('rounds/:roundId/projects/:projectId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(AdminAuditInterceptor)
  @AuditBlockchainAction({ contractField: 'roundId' })
  @ApiOperation({
    summary: 'Remove a project from a round (admin only)',
    description:
      'Removes project eligibility from a round. Requires admin role.',
  })
  @ApiResponse({
    status: 200,
    description: 'Project removed successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  @ApiResponse({ status: 404, description: 'Round or project not found' })
  removeProject(
    @Param('roundId', ParseIntPipe) roundId: number,
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser('id') actorId: number,
  ) {
    this.grantsService.removeProject(roundId, projectId, actorId);
    return { success: true };
  }

  @Get('rounds/:roundId/projects/deleted')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'List soft-deleted projects in a round (admin only)',
    description:
      'Lists recently soft-deleted project eligibility records within the retention window. Requires admin role.',
  })
  @ApiResponse({ status: 200, description: 'Deleted records retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  listDeletedProjects(@Param('roundId', ParseIntPipe) roundId: number) {
    return this.grantsService.listDeletedProjects(roundId);
  }

  @Post('rounds/:roundId/projects/:projectId/restore')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(AdminAuditInterceptor)
  @AuditBlockchainAction({ contractField: 'roundId' })
  @ApiOperation({
    summary: 'Restore a soft-deleted project in a round (admin only)',
    description:
      'Restores a previously soft-deleted project eligibility record. Requires admin role.',
  })
  @ApiResponse({ status: 200, description: 'Project restored successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  @ApiResponse({ status: 404, description: 'Deleted record not found' })
  restoreProject(
    @Param('roundId', ParseIntPipe) roundId: number,
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser('id') actorId: number,
  ) {
    return this.grantsService.restoreProject(roundId, projectId, actorId);
  }

  // Contributions

  @Post('contributions')
  @ApiOperation({
    summary: 'Record a contribution transaction',
    description:
      'Records an on-chain contribution towards a project in a round.',
  })
  @ApiResponse({
    status: 200,
    description: 'Contribution recorded successfully',
    schema: {
      type: 'object',
      properties: { success: { type: 'boolean' } },
      required: ['success'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Contribution recorded successfully',
    schema: {
      type: 'object',
      properties: { success: { type: 'boolean' } },
      required: ['success'],
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid round or project' })
  recordContribution(@Body() dto: RecordContributionDto) {
    this.grantsService.recordContribution(dto);
    return { success: true };
  }

  // Distribution

  @Post('rounds/distribute')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(AdminAuditInterceptor)
  @AuditBlockchainAction({ contractField: 'roundId' })
  @ApiOperation({
    summary: 'Distribute matching funds (admin only)',
    description:
      'Triggers distribution of matching funds for a completed round. Requires admin role.',
  })
  @ApiResponse({ status: 200, description: 'Funds distributed successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  @ApiResponse({ status: 404, description: 'Round not found' })
  distribute(@Body() dto: DistributeDto) {
    return this.grantsService.distribute(dto);
  }

  // Leaderboard

  @Get('rounds/:id/leaderboard')
  @ApiOperation({
    summary: 'Get round leaderboard',
    description:
      'Retrieves the ranked leaderboard of projects for a round based on contributions.',
  })
  @ApiResponse({
    status: 200,
    description: 'Leaderboard retrieved successfully',
    type: LeaderboardResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Round not found' })
  getLeaderboard(
    @Param('id', ParseIntPipe) roundId: number,
    @Query() query: LeaderboardQueryDto,
  ) {
    return this.grantsService.getLeaderboard(roundId, query);
  }
}
