import {
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  THROTTLER_OPTIONS,
  THROTTLER_STORAGE,
} from '@nestjs/throttler';
import { Response, Request } from 'express';
import { ErrorCode } from '../enums/error-code.enum';
import { config } from '../../lib/config';
import { getRateLimitSettings, getTrackerId } from './rate-limit.config';
import { MetricsService } from '../../metrics/metrics.service';
import * as net from 'net';

type RequestWithIp = Request & {
  ip?: string;
  user?: Record<string, unknown>;
  principal?: unknown;
  bot?: unknown;
  service?: unknown;
};

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    @Inject(THROTTLER_OPTIONS) options: ThrottlerModuleOptions,
    @Inject(THROTTLER_STORAGE) storageService: ThrottlerStorage,
    reflector: Reflector,
    @Optional() private readonly metricsService?: MetricsService,
  ) {
    super(options, storageService, reflector);
  }

  private get allowlist(): string[] | null {
    const raw = config.ipAccess?.allowlist;
    return raw
      ? raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null;
  }

  private get denylist(): string[] | null {
    const raw = config.ipAccess?.denylist;
    return raw
      ? raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null;
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return getTrackerId(req, getRateLimitSettings());
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithIp>();
    const clientIp = request.ip ?? request.socket?.remoteAddress ?? 'unknown';

    const deny = this.denylist;
    if (deny && this.isIpMatched(clientIp, deny)) {
      this.logger.warn({ clientIp }, 'Request denied by IP denylist');
      throw new HttpException(
        {
          code: ErrorCode.SYS_FORBIDDEN,
          message: 'Access denied.',
        },
        403,
      );
    }

    const allow = this.allowlist;
    if (allow && allow.length > 0) {
      if (!this.isIpMatched(clientIp, allow)) {
        this.logger.warn({ clientIp }, 'Request denied by IP allowlist');
        throw new HttpException(
          {
            code: ErrorCode.SYS_FORBIDDEN,
            message: 'Access denied.',
          },
          403,
        );
      }
    }

    const canContinue = await super.canActivate(context);

    // Set standard rate limit headers on response if available
    const response = context.switchToHttp().getResponse<Response>();
    if (response && typeof response.setHeader === 'function') {
      const tracker = getTrackerId(request as Record<string, unknown>);
      const settings = getRateLimitSettings();
      const isBotOrService =
        tracker.startsWith('bot:') || tracker.startsWith('service:');
      const limit = isBotOrService
        ? settings.botAuth.limit
        : settings.global.limit;
      const ttlSeconds = Math.ceil(
        (isBotOrService ? settings.botAuth.ttl : settings.global.ttl) / 1000,
      );

      if (!response.getHeader('X-RateLimit-Limit')) {
        response.setHeader('X-RateLimit-Limit', String(limit));
      }
      if (!response.getHeader('X-RateLimit-Reset')) {
        response.setHeader('X-RateLimit-Reset', String(ttlSeconds));
      }
    }

    return canContinue;
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest<RequestWithIp>();
    const response = context.switchToHttp().getResponse<Response>();

    const retryAfterSeconds = Math.max(
      1,
      throttlerLimitDetail.timeToBlockExpire ||
        throttlerLimitDetail.timeToExpire ||
        Math.ceil(throttlerLimitDetail.ttl / 1000),
    );

    // Requirement 3: Responses include standard rate limit headers and a Retry-After value on rejection
    if (response && typeof response.setHeader === 'function') {
      response.setHeader('Retry-After', String(retryAfterSeconds));
      response.setHeader(
        'X-RateLimit-Limit',
        String(throttlerLimitDetail.limit),
      );
      response.setHeader(
        'X-RateLimit-Remaining',
        String(
          Math.max(
            0,
            throttlerLimitDetail.limit - throttlerLimitDetail.totalHits,
          ),
        ),
      );
      response.setHeader(
        'X-RateLimit-Reset',
        String(
          throttlerLimitDetail.timeToExpire ||
            Math.ceil(throttlerLimitDetail.ttl / 1000),
        ),
      );
    }

    // Requirement 5: Limit rejections are exported as metrics labelled by endpoint class
    const endpointClass = context.getClass()?.name || 'UnknownController';
    const method = request?.method || 'UNKNOWN';
    const route = (request as any)?.route?.path || request?.url || 'unknown';

    if (this.metricsService) {
      this.metricsService.recordRateLimitRejection(
        endpointClass,
        method,
        route,
      );
    }

    this.logger.warn(
      {
        endpointClass,
        method,
        route,
        limit: throttlerLimitDetail.limit,
        retryAfterSeconds,
      },
      `Rate limit exceeded for endpoint class ${endpointClass}`,
    );

    throw new HttpException(
      {
        code: ErrorCode.SYS_RATE_LIMIT_EXCEEDED,
        message: 'Too many requests. Please try again later.',
        details: {
          limit: throttlerLimitDetail.limit,
          ttlSeconds: throttlerLimitDetail.ttl / 1000,
          retryAfterSeconds,
        },
      },
      429,
    );
  }

  private isIpMatched(ip: string, list: string[]): boolean {
    const cleanIp = ip.replace(/^::ffff:/, '');
    return list.some((entry) => {
      if (entry.includes('/')) {
        return net.isIP(cleanIp) ? this.isCidrMatch(cleanIp, entry) : false;
      }
      return cleanIp === entry || ip === entry;
    });
  }

  private isCidrMatch(ip: string, cidr: string): boolean {
    try {
      const [range, bitsStr] = cidr.split('/');
      const bits = parseInt(bitsStr, 10);

      if (!net.isIP(ip) || !net.isIP(range)) return false;
      if (net.isIPv4(ip) !== net.isIPv4(range)) return false;

      const ipBytes = ip.split('.').map(Number);
      const rangeBytes = range.split('.').map(Number);
      const mask = ~(2 ** (32 - bits) - 1);

      const ipInt =
        ((ipBytes[0] << 24) |
          (ipBytes[1] << 16) |
          (ipBytes[2] << 8) |
          ipBytes[3]) >>>
        0;
      const rangeInt =
        ((rangeBytes[0] << 24) |
          (rangeBytes[1] << 16) |
          (rangeBytes[2] << 8) |
          rangeBytes[3]) >>>
        0;

      return (ipInt & mask) === (rangeInt & mask);
    } catch {
      return false;
    }
  }
}

