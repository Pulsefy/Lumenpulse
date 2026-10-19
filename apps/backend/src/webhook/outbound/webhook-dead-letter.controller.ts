import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiOkResponse,
  ApiAcceptedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { OutboundWebhookService } from './outbound-webhook.service';
import {
  WebhookDeadLetterResponseDto,
  PaginatedWebhookDeadLettersDto,
} from './dto/webhook-subscription-response.dto';
import {
  QueryDeadLetterDto,
  ResolveWebhookDeadLetterDto,
} from './dto/query-webhook.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/decorators/auth.decorators';
import { UserRole } from '../../users/entities/user.entity';
import { JWT_SECURITY_SCHEME } from '../../openapi/openapi.constants';
import { WebhookDeadLetter } from './entities/webhook-dead-letter.entity';

interface AuthenticatedRequest extends Request {
  user?: { id?: string; email?: string };
}

@ApiTags('webhook-dead-letter')
@Controller('webhooks/dead-letter')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth(JWT_SECURITY_SCHEME)
export class WebhookDeadLetterController {
  constructor(
    private readonly outboundWebhookService: OutboundWebhookService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List dead-lettered webhook deliveries',
    description:
      'Retrieve outbound webhook deliveries that have exhausted retry attempts and moved to the dead-letter queue.',
  })
  @ApiOkResponse({
    description: 'Paginated list of dead-lettered webhook deliveries',
    type: PaginatedWebhookDeadLettersDto,
  })
  async listDeadLetters(
    @Query() query: QueryDeadLetterDto,
  ): Promise<PaginatedWebhookDeadLettersDto> {
    const result = await this.outboundWebhookService.listDeadLetters(query);
    return {
      data: result.data.map((dlq) => this.toDeadLetterDto(dlq)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Inspect a dead-lettered webhook delivery',
    description:
      'Inspect detailed error history, failure reasons, and payload for a dead-letter entry.',
  })
  @ApiParam({ name: 'id', description: 'Dead-letter record UUID' })
  @ApiOkResponse({
    description: 'Dead-letter record details',
    type: WebhookDeadLetterResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Dead-letter record not found' })
  async inspectDeadLetter(
    @Param('id') id: string,
  ): Promise<WebhookDeadLetterResponseDto> {
    const dlq = await this.outboundWebhookService.inspectDeadLetter(id);
    return this.toDeadLetterDto(dlq);
  }

  @Post(':id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Replay a dead-lettered webhook delivery',
    description:
      'Re-attempts delivery to the subscriber endpoint immediately. If successful, updates status to replayed.',
  })
  @ApiParam({ name: 'id', description: 'Dead-letter record UUID' })
  @ApiAcceptedResponse({
    description: 'Dead-letter delivery replayed',
    type: WebhookDeadLetterResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Dead-letter record not found' })
  async replayDeadLetter(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<WebhookDeadLetterResponseDto> {
    const actor = req.user?.id || req.user?.email || 'admin';
    const dlq = await this.outboundWebhookService.replayDeadLetter(id, actor);
    return this.toDeadLetterDto(dlq);
  }

  @Patch(':id/resolve')
  @ApiOperation({
    summary: 'Mark a dead-lettered webhook delivery as resolved',
    description:
      'Acknowledge and mark a dead-letter item as resolved without re-delivering.',
  })
  @ApiParam({ name: 'id', description: 'Dead-letter record UUID' })
  @ApiOkResponse({
    description: 'Dead-letter item marked as resolved',
    type: WebhookDeadLetterResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Dead-letter record not found' })
  async resolveDeadLetter(
    @Param('id') id: string,
    @Body() dto: ResolveWebhookDeadLetterDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WebhookDeadLetterResponseDto> {
    const actor = req.user?.id || req.user?.email || 'admin';
    const dlq = await this.outboundWebhookService.resolveDeadLetter(
      id,
      dto,
      actor,
    );
    return this.toDeadLetterDto(dlq);
  }

  private toDeadLetterDto(
    dlq: WebhookDeadLetter,
  ): WebhookDeadLetterResponseDto {
    return {
      id: dlq.id,
      deliveryId: dlq.deliveryId,
      subscriptionId: dlq.subscriptionId,
      eventType: dlq.eventType,
      payload: dlq.payload,
      attempts: dlq.attempts,
      lastErrorMessage: dlq.lastErrorMessage,
      errorHistory: dlq.errorHistory ?? [],
      status: dlq.status,
      maintainerNotes: dlq.maintainerNotes,
      resolvedBy: dlq.resolvedBy,
      resolvedAt: dlq.resolvedAt ? dlq.resolvedAt.toISOString() : null,
      replayedAt: dlq.replayedAt ? dlq.replayedAt.toISOString() : null,
      replayCount: dlq.replayCount,
      createdAt: dlq.createdAt ? dlq.createdAt.toISOString() : '',
    };
  }
}
