import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';
import { DataProcessingWebhookDto } from './dto/webhook-payload.dto';
import {
  WebhookVerificationGuard,
  WebhookProvider,
} from './webhook-verification.guard';

interface RawRequest {
  rawBody?: Buffer;
}

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('data-processing')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WebhookVerificationGuard)
  @WebhookProvider('data-processing')
  @ApiOperation({
    summary: 'Receive data-processing intelligence events',
    description:
      'Accepts signed webhook payloads from the Python data-processing service. ' +
      'Verifies the HMAC-SHA256 signature in the X-Webhook-Signature header and ' +
      'converts the payload into an in-app Notification.',
  })
  @ApiHeader({
    name: 'X-Webhook-Signature',
    description: 'HMAC-SHA256 signature — format: sha256=<hex>',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook accepted and notification created',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        notificationId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Malformed or unsupported payload' })
  @ApiResponse({ status: 401, description: 'Invalid or missing signature' })
  async handleDataProcessing(
    @Req() req: RawRequest,
    @Headers('x-webhook-signature') signature: string,
    @Body() payload: DataProcessingWebhookDto,
  ): Promise<{ status: string; notificationId: string }> {
    if (!req.rawBody) {
      throw new BadRequestException('Empty request body');
    }

    // Signature is already verified by the guard
    const notification =
      await this.webhookService.handleDataProcessingEvent(payload);

    return { status: 'ok', notificationId: notification.id };
  }
}
