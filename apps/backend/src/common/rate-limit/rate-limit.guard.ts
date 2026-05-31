import {
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { ErrorCode } from '../enums/error-code.enum';
import { Request } from 'express';
import { config } from '../../lib/config';
import * as net from 'net';

type RequestWithIp = Request & { ip?: string };

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  private readonly logger = new Logger(RateLimitGuard.name);

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

    return super.canActivate(context);
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    void context;
    await Promise.resolve();

    throw new HttpException(
      {
        code: ErrorCode.SYS_RATE_LIMIT_EXCEEDED,
        message: 'Too many requests. Please try again later.',
        details: {
          limit: throttlerLimitDetail.limit,
          ttlSeconds: throttlerLimitDetail.ttl / 1000,
          retryAfterSeconds: throttlerLimitDetail.timeToBlockExpire,
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
