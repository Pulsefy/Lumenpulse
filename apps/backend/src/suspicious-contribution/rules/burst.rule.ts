import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import {
  ContributionJobPayload,
  ContributionFinding,
  DetectionRule,
} from '../types';

@Injectable()
export class BurstRule implements DetectionRule {
  readonly name = 'BurstActivity';
  private readonly logger = new Logger(BurstRule.name);

  constructor(
    private readonly config: ConfigService,
    @Inject('REDIS_CONNECTION') private readonly redis: Redis,
  ) {}

  async evaluate(
    context: ContributionJobPayload,
  ): Promise<ContributionFinding | null> {
    const windowSeconds = this.config.get<number>(
      'FRAUD_BURST_WINDOW_SECONDS',
      300,
    );
    const threshold = this.config.get<number>('FRAUD_BURST_THRESHOLD', 5);

    const key = `fraud:contributions:burst:${context.roundId}:${context.contributorPublicKey}`;
    const now = Date.now();
    const member = `${now}-${context.amount}`;

    await this.redis.zadd(key, now, member);

    const cutoff = now - windowSeconds * 1000;
    await this.redis.zremrangebyscore(key, 0, cutoff);
    await this.redis.expire(key, windowSeconds);

    const count = await this.redis.zcard(key);

    if (count <= threshold) return null;

    return {
      rule: this.name,
      description: `${count} contributions within ${windowSeconds}s window (threshold: ${threshold})`,
      metrics: { count, windowSeconds, threshold },
    };
  }
}
