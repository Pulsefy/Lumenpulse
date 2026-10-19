import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
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
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { OutboundWebhookService } from './outbound-webhook.service';
import {
  CreateWebhookSubscriptionDto,
  UpdateWebhookSubscriptionDto,
  RotateWebhookSecretDto,
} from './dto/webhook-subscription.dto';
import {
  WebhookSubscriptionResponseDto,
  WebhookSecretRotationResponseDto,
  WebhookDeliveryResponseDto,
  PaginatedWebhookDeliveriesDto,
} from './dto/webhook-subscription-response.dto';
import {
  QuerySubscriptionsDto,
  QueryDeliveriesDto,
} from './dto/query-webhook.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/decorators/auth.decorators';
import { UserRole } from '../../users/entities/user.entity';
import { JWT_SECURITY_SCHEME } from '../../openapi/openapi.constants';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';

interface AuthenticatedRequest extends Request {
  user?: { id?: string; email?: string };
}

@ApiTags('webhook-subscriptions')
@Controller('webhooks/subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth(JWT_SECURITY_SCHEME)
export class WebhookSubscriptionController {
  constructor(
    private readonly outboundWebhookService: OutboundWebhookService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new partner webhook subscription',
    description:
      'Partners can register endpoints and subscribe to event types (e.g. pool.round_finalized, milestone.approved). ' +
      'A unique per-subscriber signing secret is generated and returned in the response.',
  })
  @ApiCreatedResponse({
    description: 'Webhook subscription created successfully',
    type: WebhookSubscriptionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid subscription payload' })
  async createSubscription(
    @Body() dto: CreateWebhookSubscriptionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WebhookSubscriptionResponseDto> {
    const actor = req.user?.id || req.user?.email || 'admin';
    const sub = await this.outboundWebhookService.createSubscription(
      dto,
      actor,
    );
    return this.toSubscriptionDto(sub, true);
  }

  @Get()
  @ApiOperation({
    summary: 'List all partner webhook subscriptions',
    description:
      'Returns paginated list of webhook subscriptions with optional filtering.',
  })
  @ApiOkResponse({
    description: 'Paginated list of subscriptions',
    type: [WebhookSubscriptionResponseDto],
  })
  async listSubscriptions(
    @Query() query: QuerySubscriptionsDto,
  ): Promise<WebhookSubscriptionResponseDto[]> {
    const result = await this.outboundWebhookService.listSubscriptions(query);
    return result.data.map((sub) => this.toSubscriptionDto(sub, false));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get details of a webhook subscription',
    description:
      'Returns configuration and secret metadata for a specific subscription.',
  })
  @ApiParam({ name: 'id', description: 'Subscription UUID' })
  @ApiOkResponse({
    description: 'Subscription details',
    type: WebhookSubscriptionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async getSubscription(
    @Param('id') id: string,
  ): Promise<WebhookSubscriptionResponseDto> {
    const sub = await this.outboundWebhookService.getSubscription(id);
    return this.toSubscriptionDto(sub, false);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a webhook subscription',
    description:
      'Updates target URL, subscribed event types, or active status.',
  })
  @ApiParam({ name: 'id', description: 'Subscription UUID' })
  @ApiOkResponse({
    description: 'Subscription updated successfully',
    type: WebhookSubscriptionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async updateSubscription(
    @Param('id') id: string,
    @Body() dto: UpdateWebhookSubscriptionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WebhookSubscriptionResponseDto> {
    const actor = req.user?.id || req.user?.email || 'admin';
    const sub = await this.outboundWebhookService.updateSubscription(
      id,
      dto,
      actor,
    );
    return this.toSubscriptionDto(sub, false);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a webhook subscription',
    description: 'Removes the webhook subscription and stops deliveries.',
  })
  @ApiParam({ name: 'id', description: 'Subscription UUID' })
  @ApiResponse({
    status: 204,
    description: 'Subscription deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async deleteSubscription(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const actor = req.user?.id || req.user?.email || 'admin';
    await this.outboundWebhookService.deleteSubscription(id, actor);
  }

  @Post(':id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate subscriber signing secret using Wave 9 mechanism',
    description:
      'Implements Wave 9 rotation mechanism: generates a new secret version while retaining ' +
      'the previous secret during the configured overlap window (default: 24h). ' +
      'During the overlap window, outbound deliveries include both the new and previous signature headers.',
  })
  @ApiParam({ name: 'id', description: 'Subscription UUID' })
  @ApiOkResponse({
    description: 'Secret rotated successfully with overlap window details',
    type: WebhookSecretRotationResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid rotation parameters' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async rotateSecret(
    @Param('id') id: string,
    @Body() dto: RotateWebhookSecretDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WebhookSecretRotationResponseDto> {
    const actor = req.user?.id || req.user?.email || 'admin';
    const result = await this.outboundWebhookService.rotateSecret(
      id,
      dto,
      actor,
    );

    return {
      subscriptionId: id,
      secretId: result.secretId,
      previousSecretId: result.previousSecretId,
      overlapExpiresAt: result.overlapExpiresAt
        ? result.overlapExpiresAt.toISOString()
        : null,
      newSecret: result.newSecret,
      version: result.version,
      rotatedAt: new Date().toISOString(),
    };
  }

  @Get(':id/deliveries')
  @ApiOperation({
    summary: 'Query delivery history for a subscriber',
    description:
      'Returns paginated delivery history per subscriber, with timestamps, delivery status, and signatures.',
  })
  @ApiParam({ name: 'id', description: 'Subscription UUID' })
  @ApiOkResponse({
    description: 'Paginated delivery history for the subscriber',
    type: PaginatedWebhookDeliveriesDto,
  })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async getDeliveries(
    @Param('id') id: string,
    @Query() query: QueryDeliveriesDto,
  ): Promise<PaginatedWebhookDeliveriesDto> {
    const result =
      await this.outboundWebhookService.getDeliveriesForSubscription(id, query);

    return {
      data: result.data.map((del) => this.toDeliveryDto(del)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  @Get(':id/deliveries/:deliveryId')
  @ApiOperation({
    summary: 'Inspect a specific delivery record',
    description:
      'Returns complete delivery attempt details including headers, response, and execution duration.',
  })
  @ApiParam({ name: 'id', description: 'Subscription UUID' })
  @ApiParam({ name: 'deliveryId', description: 'Delivery UUID' })
  @ApiOkResponse({
    description: 'Delivery details',
    type: WebhookDeliveryResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Delivery not found' })
  async getDelivery(
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
  ): Promise<WebhookDeliveryResponseDto> {
    const delivery = await this.outboundWebhookService.getDelivery(
      id,
      deliveryId,
    );
    return this.toDeliveryDto(delivery);
  }

  private toSubscriptionDto(
    sub: WebhookSubscription,
    revealSecret: boolean,
  ): WebhookSubscriptionResponseDto {
    return {
      id: sub.id,
      partnerId: sub.partnerId,
      name: sub.name,
      targetUrl: sub.targetUrl,
      eventTypes: sub.eventTypes,
      status: sub.status,
      secretId: sub.secretId,
      previousSecretId: sub.previousSecretId,
      overlapExpiresAt: sub.overlapExpiresAt
        ? sub.overlapExpiresAt.toISOString()
        : null,
      secretVersion: sub.secretVersion,
      ...(revealSecret ? { secret: sub.secret } : {}),
      metadata: sub.metadata,
      createdAt: sub.createdAt ? sub.createdAt.toISOString() : '',
      updatedAt: sub.updatedAt ? sub.updatedAt.toISOString() : '',
    };
  }

  private toDeliveryDto(delivery: WebhookDelivery): WebhookDeliveryResponseDto {
    return {
      id: delivery.id,
      subscriptionId: delivery.subscriptionId,
      eventType: delivery.eventType,
      payload: delivery.payload,
      status: delivery.status,
      attempts: delivery.attempts,
      maxAttempts: delivery.maxAttempts,
      responseStatusCode: delivery.responseStatusCode,
      responseBody: delivery.responseBody,
      lastError: delivery.lastError,
      requestHeaders: delivery.requestHeaders,
      executionDurationMs: delivery.executionDurationMs,
      deliveredAt: delivery.deliveredAt
        ? delivery.deliveredAt.toISOString()
        : null,
      createdAt: delivery.createdAt ? delivery.createdAt.toISOString() : '',
    };
  }
}
