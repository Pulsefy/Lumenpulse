import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
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
  ApiQuery,
} from '@nestjs/swagger';
import { OutboxService } from './outbox.service';
import { OutboxEvent } from './outbox-event.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';

/**
 * Outbox Dead Letter Controller
 *
 * Admin endpoints for inspecting and replaying outbox events that have
 * exhausted their dispatch attempts (poison messages), mirroring the
 * soroban-events dead-letter queue pattern.
 */
@ApiTags('outbox/dead-letter')
@Controller('outbox/dead-letter')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class OutboxDeadLetterController {
  private readonly logger = new Logger(OutboxDeadLetterController.name);

  constructor(private readonly outboxService: OutboxService) {}

  /**
   * List dead-lettered outbox events with pagination.
   */
  @Get()
  @ApiOperation({
    summary: 'List dead-lettered outbox events',
    description:
      'Retrieve outbox events that have exhausted their dispatch attempts ' +
      'and been moved to the dead-letter queue.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    example: 0,
    description: 'Page number (zero-indexed)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Number of results per page',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of dead-lettered outbox events',
  })
  async listDeadLetters(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const resolvedPage = Math.max(0, Number(page) || 0);
    const resolvedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    this.logger.debug(
      { page: resolvedPage, limit: resolvedLimit },
      'Listing dead-lettered outbox events',
    );
    return this.outboxService.listDeadLetters(resolvedPage, resolvedLimit);
  }

  /**
   * Inspect a single dead-lettered outbox event.
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Inspect a dead-lettered outbox event',
    description:
      'Get the full details of a dead-lettered outbox event, including ' +
      'attempt count and last error.',
  })
  @ApiParam({
    name: 'id',
    description: 'Outbox event ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Dead-lettered outbox event details',
    type: OutboxEvent,
  })
  @ApiResponse({
    status: 404,
    description: 'Event not found',
  })
  async inspectDeadLetter(@Param('id') id: string): Promise<OutboxEvent> {
    this.logger.debug({ id }, 'Inspecting dead-lettered outbox event');
    return this.outboxService.inspectDeadLetter(id);
  }

  /**
   * Replay a dead-lettered outbox event.
   *
   * Resets the attempt counter and dispatches the event immediately. A replay
   * that exhausts the attempt limit again moves the event back to the
   * dead-letter queue.
   */
  @Post(':id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Replay a dead-lettered outbox event',
    description:
      'Reset a dead-lettered outbox event and dispatch it again immediately. ' +
      'If the replay exhausts the attempt limit, the event returns to the ' +
      'dead-letter queue.',
  })
  @ApiParam({
    name: 'id',
    description: 'Outbox event ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 202,
    description: 'Event replayed',
    type: OutboxEvent,
  })
  @ApiResponse({
    status: 400,
    description: 'Event is not in the dead-letter queue',
  })
  @ApiResponse({
    status: 404,
    description: 'Event not found',
  })
  async replayDeadLetter(@Param('id') id: string): Promise<OutboxEvent> {
    this.logger.log({ id }, 'Replaying dead-lettered outbox event');
    return this.outboxService.replayDeadLetter(id);
  }
}
