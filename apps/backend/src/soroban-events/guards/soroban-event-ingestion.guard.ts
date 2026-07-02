import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Request } from 'express';
import {
  SOROBAN_SIGNATURE_HEADER,
  SOROBAN_TIMESTAMP_HEADER,
  SOROBAN_NONCE_HEADER,
  DEFAULT_TIMESTAMP_TOLERANCE_MS,
  VerifiedWebhookRequest,
} from '../interfaces/soroban-webhook.interface';

type RequestWithRawBody = Request & { rawBody?: Buffer; requestId?: string };

@Injectable()
export class SorobanEventIngestionGuard implements CanActivate {
  private readonly logger = new Logger(SorobanEventIngestionGuard.name);
  private readonly secret: string;
  private readonly timestampToleranceMs: number;

  constructor(private readonly configService: ConfigService) {
    const rawSecret = this.configService.get<string>('SOROBAN_INGEST_SECRET');
    if (!rawSecret) {
      this.logger.warn(
        'SOROBAN_INGEST_SECRET is not set — ingestion endpoint will reject all requests',
      );
    }
    const rawTolerance = this.configService.get<string>(
      'SOROBAN_TIMESTAMP_TOLERANCE_MS',
    );
    this.secret = rawSecret ?? '';
    this.timestampToleranceMs = rawTolerance
      ? Number(rawTolerance)
      : DEFAULT_TIMESTAMP_TOLERANCE_MS;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithRawBody>();

    const requestId = request.requestId ?? 'unknown';
    const rawBody = request.rawBody;

    if (!rawBody || !(rawBody instanceof Buffer) || rawBody.length === 0) {
      this.logger.warn(
        { requestId },
        'Raw body not available for verification',
      );
      throw new UnauthorizedException('Request body not available');
    }

    const signature = request.headers[SOROBAN_SIGNATURE_HEADER] as
      string | undefined;
    const timestampHeader = request.headers[SOROBAN_TIMESTAMP_HEADER] as
      string | undefined;
    const nonce = request.headers[SOROBAN_NONCE_HEADER] as string | undefined;

    if (!signature) {
      this.logger.warn({ requestId }, 'Missing soroban signature header');
      throw new UnauthorizedException('Missing signature header');
    }

    if (!timestampHeader) {
      this.logger.warn({ requestId }, 'Missing soroban timestamp header');
      throw new UnauthorizedException('Missing timestamp header');
    }

    if (!nonce) {
      this.logger.warn({ requestId }, 'Missing soroban nonce header');
      throw new UnauthorizedException('Missing nonce header');
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isInteger(timestamp) || timestamp <= 0) {
      this.logger.warn({ requestId }, 'Invalid soroban timestamp format');
      throw new UnauthorizedException('Invalid timestamp format');
    }

    const now = Date.now();
    const age = now - timestamp;
    if (age < 0) {
      this.logger.warn(
        { requestId, driftMs: Math.abs(age) },
        'Soroban timestamp is in the future',
      );
      throw new UnauthorizedException('Timestamp is in the future');
    }

    if (age > this.timestampToleranceMs) {
      this.logger.warn(
        { requestId, ageMs: age, toleranceMs: this.timestampToleranceMs },
        'Soroban timestamp expired',
      );
      throw new UnauthorizedException('Timestamp expired');
    }

    if (!this.secret) {
      this.logger.error(
        { requestId },
        'SOROBAN_INGEST_SECRET not configured — cannot verify signature',
      );
      throw new UnauthorizedException('Server configuration error');
    }

    const payload = `${timestamp}.${nonce}.${rawBody.toString('utf8')}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(payload, 'utf8')
      .digest('hex');

    if (!this.safeCompare(expectedSignature, signature)) {
      this.logger.warn({ requestId }, 'Soroban signature mismatch');
      throw new UnauthorizedException('Invalid signature');
    }

    const verified: VerifiedWebhookRequest = {
      timestamp,
      nonce,
      requestId,
      verifiedAt: new Date(),
    };
    (
      request as Request & { verifiedWebhook?: VerifiedWebhookRequest }
    ).verifiedWebhook = verified;

    this.logger.log({ requestId }, 'Soroban webhook verified successfully');

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
