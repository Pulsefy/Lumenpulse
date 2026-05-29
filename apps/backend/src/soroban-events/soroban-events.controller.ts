import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  Headers,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IngestSorobanEventDto } from './dto/ingest-soroban-event.dto';
import { SorobanEventsService } from './soroban-events.service';

@ApiTags('soroban-events')
@Controller('soroban-events')
export class SorobanEventsController {
  private readonly ingestSecret: string;

  constructor(
    private readonly service: SorobanEventsService,
    private readonly config: ConfigService,
  ) {
    this.ingestSecret = this.config.get<string>('SOROBAN_INGEST_SECRET', '');
  }

  @Post('ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Ingest a Soroban event from the indexer/cron' })
  @ApiResponse({ status: 202, description: 'Event accepted for processing' })
  @ApiResponse({ status: 401, description: 'Missing or invalid ingest secret' })
  async ingest(
    @Headers('x-ingest-secret') secret: string,
    @Body() dto: IngestSorobanEventDto,
  ) {
    if (!this.ingestSecret || secret !== this.ingestSecret) {
      throw new UnauthorizedException('Invalid ingest secret');
    }

    return this.service.ingest(dto);
  }
}
