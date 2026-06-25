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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiBody,
} from '@nestjs/swagger';
import { Request } from 'express';
import { IngestSorobanEventDto } from './dto/ingest-soroban-event.dto';
import { IngestSorobanEventResponseDto } from './dto/ingest-soroban-event-response.dto';
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
  @ApiOperation({
    summary: 'Ingest a Soroban contract event',
    description:
      'Accepts Soroban events from the indexer or cron service for processing. ' +
      'Events are queued asynchronously and their status can be checked via the returned event ID. ' +
      'This endpoint requires the SOROBAN_INGEST_SECRET header for authentication.',
  })
  @ApiHeader({
    name: 'x-ingest-secret',
    description:
      'Secret token for authenticating ingest requests (configured via SOROBAN_INGEST_SECRET environment variable)',
    example: 'your-secret-ingest-token-here',
    required: true,
  })
  @ApiBody({
    description: 'Soroban event details to ingest for processing',
    type: IngestSorobanEventDto,
  })
  @ApiResponse({
    status: 202,
    description:
      'Event accepted for processing. ' +
      'The system returns immediately with event details. ' +
      'Processing happens asynchronously - check the status field for current state.',
    type: IngestSorobanEventResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Missing or invalid x-ingest-secret header',
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad request - Invalid event data (missing txHash, invalid eventIndex, etc.)',
  })
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
