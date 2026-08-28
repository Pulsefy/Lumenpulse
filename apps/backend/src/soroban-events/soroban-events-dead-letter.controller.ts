import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
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
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SorobanEventsDeadLetterService } from './soroban-events-dead-letter.service';
import {
  ListDeadLetterEventsQueryDto,
  PaginatedDeadLetterResponseDto,
  DeadLetterEventDto,
  ReplayDeadLetterEventDto,
  ReplayDeadLetterResponseDto,
  ResolveDeadLetterEventDto,
  ResolveDeadLetterResponseDto,
  DeadLetterStatsDto,
} from './dto/dead-letter.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { User, UserRole } from '../users/entities/user.entity';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { Request } from 'express';

/**
 * Dead Letter Queue Controller
 *
 * Provides API endpoints for maintainers to:
 * - Inspect failed event processing attempts
 * - Review error history and failure reasons
 * - Replay failed events safely with idempotency
 * - Mark events as resolved when no further action is needed
 * - Monitor DLQ statistics
 *
 * All endpoints require an authenticated administrator.
 */
@ApiTags('soroban-events/dead-letter')
@Controller('soroban-events/dead-letter')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class SorobanEventsDeadLetterController {
  private readonly logger = new Logger(SorobanEventsDeadLetterController.name);

  constructor(
    private readonly dlqService: SorobanEventsDeadLetterService,
    private readonly auditService: AdminAuditService,
  ) {}

  /**
   * List all dead letter queue events with filtering and pagination
   *
   * GET /soroban-events/dead-letter
   *
   * Allows maintainers to:
   * - View all failed events
   * - Filter by status (pending, resolved, replayed)
   * - Filter by event type or contract
   * - Sort by different criteria
   * - Paginate through results
   */
  @Get()
  @ApiOperation({
    summary: 'List dead letter queue events',
    description:
      'Retrieve failed events that have exhausted retry attempts. ' +
      'Supports filtering by status, event type, contract ID, and pagination.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of dead letter queue events',
    type: PaginatedDeadLetterResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async listFailedEvents(
    @Query() query: ListDeadLetterEventsQueryDto,
  ): Promise<PaginatedDeadLetterResponseDto> {
    this.logger.debug(
      {
        page: query.page,
        limit: query.limit,
        status: query.status,
      },
      'Listing dead letter queue events',
    );

    return this.dlqService.listFailedEvents(query);
  }

  /**
   * Get statistics about the dead letter queue
   *
   * GET /soroban-events/dead-letter/stats
   */
  @Get('stats')
  @ApiOperation({
    summary: 'Get dead letter queue statistics',
    description:
      'Retrieve overview statistics including total count, status breakdown, and common errors.',
  })
  @ApiResponse({
    status: 200,
    description: 'DLQ statistics',
    type: DeadLetterStatsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async getStats(): Promise<DeadLetterStatsDto> {
    this.logger.debug('Fetching dead letter queue statistics');
    return this.dlqService.getStats();
  }

  /**
   * Inspect a specific failed event
   *
   * GET /soroban-events/dead-letter/:id
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Inspect a dead letter queue event',
    description:
      'Get detailed information about a failed event, including full error history and payload.',
  })
  @ApiParam({
    name: 'id',
    description: 'Dead letter queue entry ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Dead letter event details',
    type: DeadLetterEventDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Event not found',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async inspectFailure(
    @Param('id') dlqId: string,
  ): Promise<DeadLetterEventDto> {
    this.logger.debug({ dlqId }, 'Inspecting dead letter event');
    return this.dlqService.inspectFailure(dlqId);
  }

  /**
   * Replay a failed event
   *
   * POST /soroban-events/dead-letter/:id/replay
   *
   * Replay Strategy:
   * 1. Event is queued for processing again with high priority
   * 2. Replay counter is incremented to track attempts
   * 3. If already successfully replayed, returns idempotently
   * 4. Prevents infinite replay loops with max attempt limit
   *
   * Idempotency:
   * - Multiple calls to replay the same event won't cause duplicate processing
   * - Successfully replayed events won't be queued again
   * - Clients can safely retry the endpoint without side effects
   */
  @Post(':id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Replay a dead letter queue event',
    description:
      'Queue a failed event for reprocessing. ' +
      'Idempotent: multiple calls for an already-replayed event return success without re-queuing. ' +
      'Includes safeguards against excessive replay attempts.',
  })
  @ApiParam({
    name: 'id',
    description: 'Dead letter queue entry ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 202,
    description: 'Event accepted for replay processing',
    type: ReplayDeadLetterResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Event not found or has exceeded max replay attempts',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async replayEvent(
    @Param('id') dlqId: string,
    @Body() dto: ReplayDeadLetterEventDto,
    @Req() request: Request & { user: User },
  ): Promise<ReplayDeadLetterResponseDto> {
    this.logger.log(
      { dlqId, reason: dto.reason },
      'Replaying dead letter event',
    );

    const result = await this.dlqService.replayEvent(dlqId, dto.reason);
    await this.auditService.create({
      actorId: request.user.id,
      actorEmail: request.user.email,
      endpoint: 'POST /soroban-events/dead-letter/:id/replay',
      params: { dlqId, reason: dto.reason, jobId: result.jobId },
      responseStatus: HttpStatus.ACCEPTED,
    });
    return result;
  }

  /**
   * Mark a dead letter event as resolved
   *
   * PATCH /soroban-events/dead-letter/:id/resolve
   *
   * Use when:
   * - Issue is determined to be unfixable (e.g., deprecated contract)
   * - Manual intervention is complete
   * - Event should be acknowledged but no further action needed
   *
   * Prevents accidental re-processing and helps with audit trail
   */
  @Patch(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a dead letter event as resolved',
    description:
      'Acknowledge a failed event as resolved. ' +
      'Use when the issue is understood and no further replay is needed. ' +
      'Helps maintainers track which issues have been triaged.',
  })
  @ApiParam({
    name: 'id',
    description: 'Dead letter queue entry ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Event marked as resolved',
    type: ResolveDeadLetterResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Event not found',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async resolveFailure(
    @Param('id') dlqId: string,
    @Body() dto: ResolveDeadLetterEventDto,
  ): Promise<ResolveDeadLetterResponseDto> {
    this.logger.log(
      { dlqId, reason: dto.reason },
      'Resolving dead letter event',
    );

    const result = await this.dlqService.resolveFailure(
      dlqId,
      dto.reason,
      dto.resolvedBy,
    );
    return {
      message: result.message,
      eventId: result.eventId,
      status: result.status,
      resolvedAt: result.resolvedAt,
    };
  }
}
