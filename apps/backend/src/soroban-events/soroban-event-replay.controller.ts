import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { SorobanEventReplayService } from './soroban-event-replay.service';
import { ReplaySorobanRangeDto } from './dto/replay-range.dto';
import { ReplaySorobanRangeResponseDto } from './dto/replay-range.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { User, UserRole } from '../users/entities/user.entity';
import { AdminAuditService } from '../admin-audit/admin-audit.service';

/**
 * Replay and Backfill Controller for the Soroban Event Indexer.
 *
 * Provides a guarded admin endpoint to reprocess a historical ledger range
 * for a specific contract (or all contracts) without stopping live indexing.
 *
 * All endpoints require an authenticated administrator.
 */
@ApiTags('soroban-events/replay')
@Controller('soroban-events/replay')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class SorobanEventReplayController {
  private readonly logger = new Logger(SorobanEventReplayController.name);

  constructor(
    private readonly replayService: SorobanEventReplayService,
    private readonly auditService: AdminAuditService,
  ) {}

  /**
   * Replay a historical ledger range.
   *
   * POST /soroban-events/replay
   *
   * Re-runs the indexer over a specified ledger range so that events
   * emitted after a mapping bug fix or contract redeployment are
   * correctly captured. The operation is idempotent and does not block
   * live incremental indexing.
   *
   * Set `dryRun: true` to preview what would change without writing.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Replay a Soroban ledger range',
    description:
      'Reprocesses a specified ledger range for a specific contract (or all contracts). ' +
      'Idempotent: re-running the same range does not duplicate derived records. ' +
      'Runs without stopping live indexing. Set dryRun to true to preview changes.',
  })
  @ApiResponse({
    status: 202,
    description: 'Replay operation accepted',
    type: ReplaySorobanRangeResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid range or parameters',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async replayRange(
    @Body() dto: ReplaySorobanRangeDto,
    @Req() request: Request & { user: User },
  ): Promise<ReplaySorobanRangeResponseDto> {
    this.logger.log(
      {
        startLedger: dto.startLedger,
        endLedger: dto.endLedger,
        contractId: dto.contractId,
        dryRun: dto.dryRun,
      },
      'Replaying Soroban event range',
    );

    const result = await this.replayService.replayRange(dto);

    await this.auditService.create({
      actorId: request.user.id,
      actorEmail: request.user.email,
      endpoint: 'POST /soroban-events/replay',
      params: {
        startLedger: dto.startLedger,
        endLedger: dto.endLedger,
        contractId: dto.contractId,
        dryRun: dto.dryRun,
      },
      responseStatus: HttpStatus.ACCEPTED,
    });

    return result;
  }
}
