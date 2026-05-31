import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { IngestSorobanEventDto } from './dto/ingest-soroban-event.dto';
import { SorobanEventsService } from './soroban-events.service';
import { SorobanEventIngestionGuard } from './guards/soroban-event-ingestion.guard';
import { VerifiedWebhookRequest } from './interfaces/soroban-webhook.interface';

type RequestWithVerification = Request & {
  requestId?: string;
  verifiedWebhook?: VerifiedWebhookRequest;
};

@ApiTags('soroban-events')
@Controller('soroban-events')
export class SorobanEventsController {
  private readonly logger = new Logger(SorobanEventsController.name);

  constructor(private readonly service: SorobanEventsService) {}

  @Post('ingest')
  @UseGuards(SorobanEventIngestionGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Ingest a Soroban event from the testnet indexer' })
  @ApiResponse({ status: 202, description: 'Event accepted for processing' })
  @ApiResponse({ status: 401, description: 'Missing or invalid signature' })
  async ingest(
    @Req() req: RequestWithVerification,
    @Body() dto: IngestSorobanEventDto,
  ) {
    const requestId = req.requestId ?? 'unknown';

    this.logger.log(
      { requestId, txHash: dto.txHash, eventIndex: dto.eventIndex },
      'Ingesting soroban event',
    );

    return this.service.ingest(dto, requestId);
  }
}
