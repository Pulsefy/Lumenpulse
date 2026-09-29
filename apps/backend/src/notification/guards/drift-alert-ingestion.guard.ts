import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Request } from 'express';

/**
 * Headers used to authenticate drift-alert delivery from the Python
 * data-processing service (#1447).
 */
export const DRIFT_ALERT_SIGNATURE_HEADER = 'x-drift-alert-signature';
export const DRIFT_ALERT_TIMESTAMP_HEADER = 'x-drift-alert-timestamp';
export const DRIFT_ALERT_IDEMPOTENCY_HEADER = 'x-drift-alert-id';
export const DRIFT_ALERT_TIMESTAMP_TOLERANCE_MS_ENV =
  'DRIFT_ALERT_TIMESTAMP_TOLERANCE_MS';
export const DEFAULT_DRIFT_ALERT_TIMESTAMP_TOLERANCE_MS = 300_000;

type RequestWithRawBody = Request & { rawBody?: Buffer; requestId?: string };

/**
 * Guard for the drift-alert ingest endpoint.
 *
 * The data-processing service signs each alert delivery with the shared
 * DRIFT_ALERT_INGEST_SECRET using the same HMAC scheme as the Soroban
 * ingestion endpoint (sha256 of "<timestamp>.<body>"):
 *
 *   x-drift-alert-signature: hex hmac-sha256(`${timestamp}.${rawBody}`)
 *   x-drift-alert-timestamp: epoch millis (within tolerance)
 *
 * Rejecting unsigned/untrusted requests keeps the backend notification
 * system from becoming an open spam channel. When the secret is not
 * configured the guard fails closed: every request is rejected.
 */
@Injectable()
export class DriftAlertIngestionGuard implements CanActivate {
  private readonly logger = new Logger(DriftAlertIngestionGuard.name);
  private readonly secret: string;
  private readonly timestampToleranceMs: number;

  constructor(private readonly configService: ConfigService) {
    const rawSecret = this.configService.get<string>(
      'DRIFT_ALERT_INGEST_SECRET',
    );
    if (!rawSecret) {
      this.logger.warn(
        'DRIFT_ALERT_INGEST_SECRET is not set — drift alert ingest endpoint will reject all requests',
      );
    }
    const rawTolerance = this.configService.get<string>(
      DRIFT_ALERT_TIMESTAMP_TOLERANCE_MS_ENV,
    );
    this.secret = rawSecret ?? '';
    this.timestampToleranceMs = rawTolerance
      ? Number(rawTolerance)
      : DEFAULT_DRIFT_ALERT_TIMESTAMP_TOLERANCE_MS;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithRawBody>();
    const requestId = request.requestId ?? 'unknown';
    const rawBody = request.rawBody;

    if (!rawBody || !(rawBody instanceof Buffer) || rawBody.length === 0) {
      this.logger.warn(
        { requestId },
        'Raw body not available for drift alert verification',
      );
      throw new UnauthorizedException('Request body not available');
    }

    const signature = request.headers[DRIFT_ALERT_SIGNATURE_HEADER] as
      | string
      | undefined;
    const timestampHeader = request.headers[DRIFT_ALERT_TIMESTAMP_HEADER] as
      | string
      | undefined;

    if (!signature) {
      this.logger.warn({ requestId }, 'Missing drift alert signature header');
      throw new UnauthorizedException('Missing signature header');
    }

    if (!timestampHeader) {
      this.logger.warn({ requestId }, 'Missing drift alert timestamp header');
      throw new UnauthorizedException('Missing timestamp header');
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isInteger(timestamp) || timestamp <= 0) {
      this.logger.warn({ requestId }, 'Invalid drift alert timestamp format');
      throw new UnauthorizedException('Invalid timestamp format');
    }

    const now = Date.now();
    const age = now - timestamp;
    if (age < 0) {
      this.logger.warn(
        { requestId, driftMs: Math.abs(age) },
        'Drift alert timestamp is in the future',
      );
      throw new UnauthorizedException('Timestamp is in the future');
    }

    if (age > this.timestampToleranceMs) {
      this.logger.warn(
        { requestId, ageMs: age, toleranceMs: this.timestampToleranceMs },
        'Drift alert timestamp expired',
      );
      throw new UnauthorizedException('Timestamp expired');
    }

    if (!this.secret) {
      this.logger.error(
        { requestId },
        'DRIFT_ALERT_INGEST_SECRET not configured — cannot verify signature',
      );
      throw new ServiceUnavailableException('Server configuration error');
    }

    const payload = `${timestamp}.${rawBody.toString('utf8')}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(payload, 'utf8')
      .digest('hex');

    if (!this.safeCompare(expectedSignature, signature)) {
      this.logger.warn({ requestId }, 'Drift alert signature mismatch');
      throw new UnauthorizedException('Invalid signature');
    }

    this.logger.log(
      { requestId, alertId: request.headers[DRIFT_ALERT_IDEMPOTENCY_HEADER] },
      'Drift alert request authenticated successfully',
    );

    return true;
  }

  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  }
}
