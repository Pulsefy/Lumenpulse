import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { WebhookVerificationService } from './webhook-verification.service';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Metadata key for webhook provider name
 */
export const WEBHOOK_PROVIDER_KEY = 'webhook:provider';

/** Default timestamp tolerance window (5 minutes) */
const DEFAULT_TIMESTAMP_TOLERANCE_MS = 300_000;

/** How often to purge expired nonces from the in-memory store */
const NONCE_CLEANUP_INTERVAL_MS = 60_000;

/**
 * Decorator to specify which webhook provider to use for verification
 */
export const WebhookProvider = (provider: string) => {
  return (
    target: object,
    key?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    if (descriptor) {
      // Method decorator
      Reflect.defineMetadata(
        WEBHOOK_PROVIDER_KEY,
        provider,
        descriptor.value as object,
      );
    } else {
      // Class decorator
      Reflect.defineMetadata(WEBHOOK_PROVIDER_KEY, provider, target);
    }
  };
};

/**
 * Guard that verifies webhook signatures, enforces a timestamp tolerance
 * window, and rejects replayed deliveries via a seen-nonce store.
 *
 * Required headers:
 *   X-Webhook-Signature  — HMAC/RSA/Ed25519 signature
 *   X-Webhook-Timestamp  — Unix epoch milliseconds
 *   X-Webhook-Nonce      — Unique per-delivery identifier (UUID recommended)
 *
 * Apply @WebhookProvider('provider-name') to routes that need verification.
 */
@Injectable()
export class WebhookVerificationGuard implements CanActivate {
  private readonly logger = new Logger(WebhookVerificationGuard.name);

  /** nonce → expiry timestamp (ms) */
  private readonly seenNonces = new Map<string, number>();

  private readonly timestampToleranceMs: number;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly verificationService: WebhookVerificationService,
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    const rawTolerance = this.configService.get<string>(
      'WEBHOOK_TIMESTAMP_TOLERANCE_MS',
    );
    this.timestampToleranceMs = rawTolerance
      ? Number(rawTolerance)
      : DEFAULT_TIMESTAMP_TOLERANCE_MS;

    // Periodic cleanup so the nonce store doesn't grow unbounded
    this.cleanupTimer = setInterval(
      () => this.purgeExpiredNonces(),
      NONCE_CLEANUP_INTERVAL_MS,
    );
    // Allow the process to exit without waiting for the timer
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Get provider name from route metadata or query parameter
    let providerName = this.reflector.get<string>(
      WEBHOOK_PROVIDER_KEY,
      context.getHandler(),
    );

    // Fallback to class-level metadata
    if (!providerName) {
      providerName = this.reflector.get<string>(
        WEBHOOK_PROVIDER_KEY,
        context.getClass(),
      );
    }

    // Fallback to query parameter (for dynamic routing)
    if (!providerName) {
      const queryProvider = (request.query as Record<string, unknown>)
        ?.provider as string | undefined;
      providerName =
        queryProvider || (request.headers['x-webhook-provider'] as string);
    }

    if (!providerName) {
      this.reject(request, 'missing_provider', 'No webhook provider specified');
      throw new UnauthorizedException('Webhook provider not specified');
    }

    // ── Raw body ────────────────────────────────────────────────────
    const reqWithRawBody = request as Request & { rawBody?: Buffer };
    const rawBody = reqWithRawBody.rawBody;
    if (!rawBody || !(rawBody instanceof Buffer)) {
      this.reject(
        request,
        'missing_body',
        'Raw body not available for verification',
      );
      throw new UnauthorizedException('Request body not available');
    }

    // ── Provider config & header names ──────────────────────────────
    const providerInfo = this.verificationService.getProviderInfo(providerName);
    const signatureHeaderName =
      providerInfo?.signatureHeader?.toLowerCase() || 'x-webhook-signature';
    const timestampHeaderName =
      providerInfo?.timestampHeader?.toLowerCase() || 'x-webhook-timestamp';

    const signatureHeader = request.headers[signatureHeaderName] as
      | string
      | undefined;
    const timestampHeader = request.headers[timestampHeaderName] as
      | string
      | undefined;
    const nonceHeader = request.headers['x-webhook-nonce'] as
      | string
      | undefined;

    if (!signatureHeader) {
      this.reject(request, 'missing_signature', 'Missing signature header');
      throw new UnauthorizedException('Missing signature header');
    }

    // ── Timestamp tolerance ─────────────────────────────────────────
    if (!timestampHeader) {
      this.reject(
        request,
        'missing_timestamp',
        'Missing timestamp header — replay protection requires X-Webhook-Timestamp',
      );
      throw new UnauthorizedException('Missing timestamp header');
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isInteger(timestamp) || timestamp <= 0) {
      this.reject(
        request,
        'invalid_timestamp',
        'Invalid timestamp format — expected unix epoch ms',
      );
      throw new UnauthorizedException('Invalid timestamp format');
    }

    const now = Date.now();
    const age = now - timestamp;

    if (age < 0) {
      this.reject(
        request,
        'future_timestamp',
        `Timestamp is in the future (drift: ${Math.abs(age)}ms)`,
      );
      throw new UnauthorizedException('Timestamp is in the future');
    }

    if (age > this.timestampToleranceMs) {
      this.reject(
        request,
        'expired_timestamp',
        `Timestamp expired (age: ${age}ms, tolerance: ${this.timestampToleranceMs}ms)`,
      );
      throw new UnauthorizedException('Timestamp expired');
    }

    // ── Nonce dedup ─────────────────────────────────────────────────
    if (!nonceHeader) {
      this.reject(
        request,
        'missing_nonce',
        'Missing nonce header — replay protection requires X-Webhook-Nonce',
      );
      throw new UnauthorizedException('Missing nonce header');
    }

    const nonceExpiry = this.seenNonces.get(nonceHeader);
    if (nonceExpiry !== undefined) {
      this.reject(
        request,
        'replayed_nonce',
        'Duplicate nonce detected — delivery already processed',
      );
      throw new UnauthorizedException('Duplicate webhook delivery (replay)');
    }

    // Mark nonce as seen; expires together with the tolerance window
    this.seenNonces.set(nonceHeader, now + this.timestampToleranceMs);

    // ── Signature verification ──────────────────────────────────────
    const result = this.verificationService.verifySignature(
      providerName,
      rawBody,
      signatureHeader,
      timestampHeader,
    );

    // Add verification metadata to request for downstream use
    const reqWithVerification = request as Request & {
      webhookVerification?: object;
    };
    reqWithVerification.webhookVerification = {
      provider: providerName,
      valid: result.valid,
      algorithm: result.algorithm,
      verifiedAt: new Date(),
    };

    if (!result.valid) {
      this.reject(
        request,
        'signature_mismatch',
        `Signature verification failed for provider ${providerName}: ${result.error}`,
      );
      throw new UnauthorizedException(
        result.error || 'Webhook signature verification failed',
      );
    }

    this.logger.log(
      `Webhook verified successfully from provider ${providerName} using ${result.algorithm}`,
    );

    return true;
  }

  /**
   * Log the rejection reason and increment the webhook_rejections_total
   * Prometheus counter so it is visible on the /metrics scrape endpoint.
   */
  private reject(request: Request, reason: string, message: string): void {
    const route =
      ((request.route as Record<string, unknown>)?.path as string) ??
      request.path ??
      'unknown';
    const method = request.method ?? 'POST';

    this.logger.warn({ reason, route, method }, `Webhook rejected: ${message}`);

    this.metricsService.incrementCounter('webhook_rejections_total', {
      reason,
      route,
      method,
    });
  }

  /**
   * Remove nonces whose TTL has expired so the in-memory store stays
   * bounded. Runs periodically via the cleanup timer.
   */
  private purgeExpiredNonces(): void {
    const now = Date.now();
    let purged = 0;
    for (const [nonce, expiry] of this.seenNonces) {
      if (expiry <= now) {
        this.seenNonces.delete(nonce);
        purged++;
      }
    }
    if (purged > 0) {
      this.logger.debug(`Purged ${purged} expired nonces from replay store`);
    }
  }
}
