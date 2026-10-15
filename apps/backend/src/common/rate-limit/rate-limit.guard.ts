import {
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerRequest,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { createHash } from 'crypto';
import { ErrorCode } from '../enums/error-code.enum';
import { Request } from 'express';
import { config } from '../../lib/config';
import { MetricsService } from '../../metrics/metrics.service';
import * as net from 'net';
import {
  ENDPOINT_CLASS_METRIC_LABELS,
  EXPENSIVE_ENDPOINT_CLASSES,
  RATE_LIMIT_ENDPOINT_CLASS_KEY,
  RATE_LIMIT_ENDPOINT_CLASSES,
  RateLimitEndpointClass,
  RateLimitPrincipal,
} from './rate-limit.constants';
import {
  getRateLimitSettings,
  getTrackerId,
  RateLimitSettings,
  resolveEffectiveProfile,
} from './rate-limit.config';
import { RateLimitPrincipalResolver } from './rate-limit.principal';

type RequestWithIp = Request & { ip?: string };

interface HeaderWriter {
  header?: (name: string, value: string | number) => unknown;
  setHeader?: (name: string, value: string | number) => unknown;
}

interface RateLimitRejectionDetail extends ThrottlerLimitDetail {
  endpointClass: RateLimitEndpointClass;
  principalType: RateLimitPrincipal['type'];
  retryAfterSeconds: number;
}

const KNOWN_ENDPOINT_CLASSES: ReadonlySet<string> = new Set(
  RATE_LIMIT_ENDPOINT_CLASSES,
);

/**
 * Metadata key prefix written by `@Throttle()` for route/class limit
 * overrides (`THROTTLER_LIMIT` in @nestjs/throttler, not re-exported by the
 * package index).
 */
const THROTTLER_LIMIT_METADATA_PREFIX = 'THROTTLER:LIMIT';

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly principalResolver: RateLimitPrincipalResolver;
  private cachedSettings?: RateLimitSettings;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    @Optional() principalResolver?: RateLimitPrincipalResolver,
    @Optional() private readonly metricsService?: MetricsService,
  ) {
    super(options, storageService, reflector);
    this.principalResolver =
      principalResolver ?? new RateLimitPrincipalResolver();
  }

  private get settings(): RateLimitSettings {
    if (!this.cachedSettings) {
      this.cachedSettings = getRateLimitSettings();
    }
    return this.cachedSettings;
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

    // Resolve (and cache on the request) the principal before any throttler
    // runs, so the tracker is keyed by the authenticated principal where one
    // exists and by source address otherwise.
    this.principalResolver.resolve(
      request as unknown as Record<string, unknown>,
      getTrackerId(
        request as unknown as Record<string, unknown>,
        this.settings,
      ),
    );

    return super.canActivate(context);
  }

  protected override async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const { context, throttler, getTracker, generateKey } = requestProps;
    const { req, res } = this.getRequestResponse(context);

    const ignoreUserAgents =
      throttler.ignoreUserAgents ?? this.commonOptions.ignoreUserAgents;
    if (Array.isArray(ignoreUserAgents)) {
      const headers = (
        req as { headers?: Record<string, string | string[] | undefined> }
      ).headers;
      const rawUserAgent = headers?.['user-agent'];
      const userAgent =
        (Array.isArray(rawUserAgent) ? rawUserAgent[0] : rawUserAgent) ?? '';
      for (const pattern of ignoreUserAgents) {
        if (pattern.test(userAgent)) {
          return true;
        }
      }
    }

    const principal = this.principalResolver.resolve(
      req,
      getTrackerId(req, this.settings),
    );
    const endpointClass = this.getEndpointClass(context);
    const throttlerName = throttler.name ?? 'default';
    const routeProfile = {
      limit: requestProps.limit,
      ttl: requestProps.ttl,
      blockDuration: requestProps.blockDuration,
    };
    // A route with its own `@Throttle` override but no endpoint class keeps
    // that override for every principal: the bot / service *global* budget
    // must never loosen a deliberately strict route.
    const profile =
      endpointClass === 'global' &&
      this.hasRouteThrottleOverride(context, throttlerName)
        ? routeProfile
        : resolveEffectiveProfile(
            this.settings,
            endpointClass,
            principal.type,
            routeProfile,
          );

    const tracker = await getTracker(req, context);
    const key = EXPENSIVE_ENDPOINT_CLASSES.has(endpointClass)
      ? this.generateClassKey(endpointClass, principal, tracker, throttlerName)
      : generateKey(context, tracker, throttlerName);

    const { totalHits, timeToExpire, isBlocked, timeToBlockExpire } =
      await this.storageService.increment(
        key,
        profile.ttl,
        profile.limit,
        profile.blockDuration,
        throttlerName,
      );

    const setHeaders =
      throttler.setHeaders ?? this.commonOptions.setHeaders ?? true;
    const suffix = throttlerName === 'default' ? '' : `-${throttlerName}`;
    const writer = res as HeaderWriter;

    if (isBlocked) {
      const retryAfterSeconds = Math.max(1, Math.ceil(timeToBlockExpire));

      if (setHeaders) {
        this.writeRateLimitHeaders(writer, suffix, {
          limit: profile.limit,
          remaining: 0,
          resetSeconds: retryAfterSeconds,
          windowSeconds: Math.ceil(profile.ttl / 1000),
        });
        this.setHeader(writer, `Retry-After${suffix}`, retryAfterSeconds);
      }

      this.recordRejection(endpointClass, principal);

      await this.throwThrottlingException(context, {
        limit: profile.limit,
        ttl: profile.ttl,
        key,
        tracker,
        totalHits,
        timeToExpire,
        isBlocked,
        timeToBlockExpire: retryAfterSeconds,
        endpointClass,
        principalType: principal.type,
        retryAfterSeconds,
      } as RateLimitRejectionDetail);
    }

    if (setHeaders) {
      this.writeRateLimitHeaders(writer, suffix, {
        limit: profile.limit,
        remaining: Math.max(0, profile.limit - totalHits),
        resetSeconds: Math.max(0, Math.ceil(timeToExpire)),
        windowSeconds: Math.ceil(profile.ttl / 1000),
      });
    }

    return true;
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    void context;
    await Promise.resolve();

    const detail = throttlerLimitDetail as Partial<RateLimitRejectionDetail> &
      ThrottlerLimitDetail;
    const retryAfterSeconds =
      detail.retryAfterSeconds ??
      Math.max(1, Math.ceil(throttlerLimitDetail.timeToBlockExpire));

    throw new HttpException(
      {
        code: ErrorCode.SYS_RATE_LIMIT_EXCEEDED,
        message: 'Too many requests. Please try again later.',
        details: {
          limit: throttlerLimitDetail.limit,
          ttlSeconds: throttlerLimitDetail.ttl / 1000,
          retryAfterSeconds,
          ...(detail.endpointClass
            ? {
                endpointClass:
                  ENDPOINT_CLASS_METRIC_LABELS[detail.endpointClass],
              }
            : {}),
        },
      },
      429,
    );
  }

  /** Endpoint class declared on the handler / controller, else `global`. */
  private getEndpointClass(context: ExecutionContext): RateLimitEndpointClass {
    const declared = this.reflector.getAllAndOverride<string | undefined>(
      RATE_LIMIT_ENDPOINT_CLASS_KEY,
      [context.getHandler(), context.getClass()],
    );

    return declared && KNOWN_ENDPOINT_CLASSES.has(declared)
      ? (declared as RateLimitEndpointClass)
      : 'global';
  }

  private hasRouteThrottleOverride(
    context: ExecutionContext,
    throttlerName: string,
  ): boolean {
    return (
      this.reflector.getAllAndOverride<unknown>(
        `${THROTTLER_LIMIT_METADATA_PREFIX}${throttlerName}`,
        [context.getHandler(), context.getClass()],
      ) !== undefined
    );
  }

  /**
   * Bucket key shared by every route of an expensive endpoint class, so the
   * class budget cannot be multiplied by spreading calls across its routes.
   */
  private generateClassKey(
    endpointClass: RateLimitEndpointClass,
    principal: RateLimitPrincipal,
    tracker: string,
    throttlerName: string,
  ): string {
    return createHash('sha256')
      .update(
        `rate-limit-class:${endpointClass}:${throttlerName}:${principal.type}:${tracker}`,
      )
      .digest('hex');
  }

  /**
   * Emits both the IETF standard `RateLimit-*` headers
   * (draft-ietf-httpapi-ratelimit-headers) and the widely used legacy
   * `X-RateLimit-*` headers for backwards compatibility.
   */
  private writeRateLimitHeaders(
    res: HeaderWriter,
    suffix: string,
    values: {
      limit: number;
      remaining: number;
      resetSeconds: number;
      windowSeconds: number;
    },
  ): void {
    this.setHeader(res, `RateLimit-Limit${suffix}`, values.limit);
    this.setHeader(res, `RateLimit-Remaining${suffix}`, values.remaining);
    this.setHeader(res, `RateLimit-Reset${suffix}`, values.resetSeconds);
    this.setHeader(
      res,
      `RateLimit-Policy${suffix}`,
      `${values.limit};w=${values.windowSeconds}`,
    );
    this.setHeader(res, `${this.headerPrefix}-Limit${suffix}`, values.limit);
    this.setHeader(
      res,
      `${this.headerPrefix}-Remaining${suffix}`,
      values.remaining,
    );
    this.setHeader(
      res,
      `${this.headerPrefix}-Reset${suffix}`,
      values.resetSeconds,
    );
  }

  private setHeader(
    res: HeaderWriter,
    name: string,
    value: string | number,
  ): void {
    if (typeof res.header === 'function') {
      res.header(name, value);
    } else if (typeof res.setHeader === 'function') {
      res.setHeader(name, value);
    }
  }

  private recordRejection(
    endpointClass: RateLimitEndpointClass,
    principal: RateLimitPrincipal,
  ): void {
    const label = ENDPOINT_CLASS_METRIC_LABELS[endpointClass];
    try {
      this.metricsService?.recordRateLimitRejection(label, principal.type);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to record rate-limit metric: ${message}`);
    }

    this.logger.warn(
      `Rate limit exceeded: class=${label} principal=${principal.type}`,
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
