import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { GrantsService } from './grants.service';
import {
  ApproveProjectDto,
  CreateRoundDto,
  FundPoolDto,
  RecordContributionDto,
  DistributeDto,
  RoundDto,
  RoundSummaryDto,
  RoundExportDto,
} from './dto/grants.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('grants')
@Controller('grants')
export class GrantsController {
  constructor(private readonly grantsService: GrantsService) {}

  // ── Rounds ─────────────────────────────────────────────────────────────────

  @Get('rounds')
  @ApiOperation({
    summary: 'List all grant rounds',
    description:
      'Retrieves all available grant rounds (active, pending, finalized).',
  })
  @ApiResponse({
    status: 200,
    description: 'List of rounds retrieved successfully',
    type: [RoundDto],
  })
  listRounds() {
    return this.grantsService.listRounds();
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
  @ApiOperation({
    summary: 'Finalize a grant round (admin only)',
    description:
      'Flags the round as finalized, calculating final matching pool allocations. Requires admin role.',
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

  // ── Pool funding ───────────────────────────────────────────────────────────

  @Post('rounds/fund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Fund the matching pool (admin only)',
    description:
      'Records funding into the matching pool for a specific round. Requires admin role.',
  })
  @ApiResponse({
    status: 200,
    description: 'Matching pool funded successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  @ApiResponse({ status: 404, description: 'Round not found' })
  fundPool(@Body() dto: FundPoolDto) {
    return this.grantsService.fundPool(dto);
  }

  // ── Eligibility ────────────────────────────────────────────────────────────

  @Post('rounds/projects/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @ApiOperation({
    summary: 'Approve a project for a round (admin/reviewer only)',
    description:
      'Approves project eligibility to receive match funding in the round. Requires admin or reviewer role.',
  })
  @ApiResponse({
    status: 200,
    description: 'Project approved successfully',
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
  ) {
    this.grantsService.removeProject(roundId, projectId);
    return { success: true };
  }

  // ── Contributions ──────────────────────────────────────────────────────────

  @Post('contributions')
  @ApiOperation({
    summary: 'Record a contribution transaction',
    description:
      'Records an on-chain contribution towards a project in a round.',
  })
  @ApiResponse({
    status: 200,
    description: 'Contribution recorded successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid round or project' })
  recordContribution(@Body() dto: RecordContributionDto) {
    this.grantsService.recordContribution(dto);
    return { success: true };
  }

  // ── Distribution ───────────────────────────────────────────────────────────

  @Post('rounds/distribute')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Distribute matching pool allocations (admin only)',
    description:
      'Distributes pool allocations to approved project owners. Requires admin role.',
  })
  @ApiResponse({
    status: 200,
    description: 'Distribution completed successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  @ApiResponse({ status: 404, description: 'Round not found' })
  distribute(@Body() dto: DistributeDto) {
    return this.grantsService.distribute(dto);
  }
}
