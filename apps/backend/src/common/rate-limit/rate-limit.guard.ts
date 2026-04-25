import { ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { ErrorCode } from '../enums/error-code.enum';

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
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
}
