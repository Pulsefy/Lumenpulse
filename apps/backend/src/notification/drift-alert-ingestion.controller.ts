import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { WEBHOOK_SIGNATURE_SECURITY_SCHEME } from '../openapi/openapi.constants';
import { Request } from 'express';
import { DriftAlertIngestionService } from './drift-alert-ingestion.service';
import { DriftAlertIngestionGuard } from './guards/drift-alert-ingestion.guard';
import {
  DRIFT_ALERT_IDEMPOTENCY_HEADER,
  DRIFT_ALERT_SIGNATURE_HEADER,
  DRIFT_ALERT_TIMESTAMP_HEADER,
} from './guards/drift-alert-ingestion.guard';
import {
  DriftAlertRequestDto,
  DriftAlertResponseDto,
} from './dto/drift-alert.dto';

type RequestWithRawBody = Request & { rawBody?: Buffer; requestId?: string };

/**
 * Authenticated ingest endpoint for drift alerts raised by the Python
 * data-processing service (#1447).
 *
 * Alerts arrive HMAC-signed (see DriftAlertIngestionGuard) and are stored
 * through the standard NotificationService so they appear in the backend
 * notification system with a mapped priority severity.
 */
@ApiTags('notification-fanout')
@Controller('notifications')
export class DriftAlertIngestionController {
  private readonly logger = new Logger(DriftAlertIngestionController.name);

  constructor(
    private readonly driftAlertIngestionService: DriftAlertIngestionService,
  ) {}

  @Post('drift-alerts')
  @UseGuards(DriftAlertIngestionGuard)
  @ApiSecurity(WEBHOOK_SIGNATURE_SECURITY_SCHEME)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Ingest a drift alert from the data-processing service',
    description:
      'Accepts model/metadata drift alerts raised by the data-processing alert engine and ' +
      'stores them as backend notifications. Requires HMAC authentication via the ' +
      'x-drift-alert-signature and x-drift-alert-timestamp headers, signed with DRIFT_ALERT_INGEST_SECRET.',
  })
  @ApiHeader({
    name: DRIFT_ALERT_SIGNATURE_HEADER,
    description:
      'Hex HMAC-SHA256 signature of "<timestamp>.<raw body>" computed with DRIFT_ALERT_INGEST_SECRET',
    required: true,
  })
  @ApiHeader({
    name: DRIFT_ALERT_TIMESTAMP_HEADER,
    description: 'Epoch milliseconds when the request was signed',
    required: true,
  })
  @ApiHeader({
    name: DRIFT_ALERT_IDEMPOTENCY_HEADER,
    description: 'UUID identifying the alert (dedup key from the alert engine)',
    required: false,
  })
  @ApiBody({ type: DriftAlertRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Alert accepted and stored as notification(s)',
    type: DriftAlertResponseDto,
  })
  @ApiResponse({
    status: 401,
    description:
      'Unauthorized - missing/invalid signature, or timestamp outside tolerance',
  })
  async ingest(
    @Req() req: RequestWithRawBody,
    @Body() dto: DriftAlertRequestDto,
  ): Promise<DriftAlertResponseDto> {
    const requestId = req.requestId ?? 'unknown';
    this.logger.log(
      { requestId, alertId: dto.alertId },
      'Ingesting drift alert',
    );
    return this.driftAlertIngestionService.ingestAlert(dto);
  }
}
