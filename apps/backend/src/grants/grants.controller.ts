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
import { GrantsService } from './grants.service';
import {
  ApproveProjectDto,
  CreateRoundDto,
  DistributeDto,
  FundPoolDto,
  RecordContributionDto,
} from './dto/grants.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';

@Controller('grants')
export class GrantsController {
  constructor(private readonly grantsService: GrantsService) {}

  // ── Rounds ─────────────────────────────────────────────────────────────────

  @Get('rounds')
  listRounds() {
    return this.grantsService.listRounds();
  }

  @Get('rounds/:id')
  getRound(@Param('id', ParseIntPipe) id: number) {
    return this.grantsService.getRound(id);
  }

  @Get('rounds/:id/summary')
  getRoundSummary(@Param('id', ParseIntPipe) id: number) {
    return this.grantsService.getRoundSummary(id);
  }

  @Post('rounds')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  createRound(@Body() dto: CreateRoundDto) {
    return this.grantsService.createRound(dto);
  }

  @Post('rounds/:id/finalize')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  finalizeRound(@Param('id', ParseIntPipe) id: number) {
    return this.grantsService.finalizeRound(id);
  }

  // ── Pool funding ───────────────────────────────────────────────────────────

  @Post('rounds/fund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  fundPool(@Body() dto: FundPoolDto) {
    return this.grantsService.fundPool(dto);
  }

  // ── Eligibility ────────────────────────────────────────────────────────────

  @Post('rounds/projects/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  approveProject(@Body() dto: ApproveProjectDto) {
    this.grantsService.approveProject(dto);
    return { success: true };
  }

  @Delete('rounds/:roundId/projects/:projectId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  removeProject(
    @Param('roundId', ParseIntPipe) roundId: number,
    @Param('projectId', ParseIntPipe) projectId: number,
  ) {
    this.grantsService.removeProject(roundId, projectId);
    return { success: true };
  }

  // ── Contributions ──────────────────────────────────────────────────────────

  @Post('contributions')
  recordContribution(@Body() dto: RecordContributionDto) {
    this.grantsService.recordContribution(dto);
    return { success: true };
  }

  // ── Distribution ───────────────────────────────────────────────────────────

  @Post('rounds/distribute')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  distribute(@Body() dto: DistributeDto) {
    return this.grantsService.distribute(dto);
  }
}
