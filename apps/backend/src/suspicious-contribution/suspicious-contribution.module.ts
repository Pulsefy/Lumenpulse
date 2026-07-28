import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { QueueModule } from '../queue/queue.module';
import { ModerationModule } from '../moderation/moderation.module';
import { DetectionService } from './detection.service';
import { SuspiciousContributionProcessor } from './suspicious-contribution.processor';
import { LargeContributionRule } from './rules/large-contribution.rule';
import { BurstRule } from './rules/burst.rule';
import { ConcentrationRule } from './rules/concentration.rule';
import { DetectionRule, CONTRIBUTION_QUEUE } from './types';

@Module({
  imports: [
    QueueModule,
    ModerationModule,
    BullModule.registerQueue({ name: CONTRIBUTION_QUEUE }),
  ],
  providers: [
    {
      provide: 'REDIS_CONNECTION',
      useFactory: (configService: ConfigService): IORedis => {
        const host = configService.get<string>('REDIS_HOST', 'localhost');
        const port = configService.get<number>('REDIS_PORT', 6379);
        return new IORedis({ host, port });
      },
      inject: [ConfigService],
    },
    LargeContributionRule,
    BurstRule,
    ConcentrationRule,
    {
      provide: DetectionService,
      useFactory: (...rules: DetectionRule[]) => new DetectionService(rules),
      inject: [LargeContributionRule, BurstRule, ConcentrationRule],
    },
    SuspiciousContributionProcessor,
  ],
  exports: [DetectionService, BullModule],
})
export class SuspiciousContributionModule {}
