// src/portfolio/portfolio.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PortfolioAsset } from './portfolio-asset.entity';
import { PortfolioSnapshot } from './entities/portfolio-snapshot.entity';
import { User } from '../users/entities/user.entity';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { StellarBalanceService } from './stellar-balance.service';
import { MetricsModule } from '../metrics/metrics.module';
import {
  PORTFOLIO_SNAPSHOT_CONNECTION,
  PORTFOLIO_SNAPSHOT_QUEUE,
  PORTFOLIO_SNAPSHOT_QUEUE_NAME,
} from './queue/portfolio-snapshot.constants';
import { PortfolioSnapshotProgressStore } from './queue/portfolio-snapshot.progress-store';
import { PortfolioSnapshotQueueService } from './queue/portfolio-snapshot.queue.service';
import { PortfolioSnapshotWorker } from './queue/portfolio-snapshot.worker';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { StellarModule } from '../stellar/stellar.module';
import { PriceModule } from '../price/price.module';
import { ProfilingModule } from '../common/profiling/profiling.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PortfolioAsset, PortfolioSnapshot, User]),
    MetricsModule,
    ExchangeRatesModule,
    StellarModule,
    PriceModule,
    ProfilingModule,
  ],
  controllers: [PortfolioController],
  providers: [
    PortfolioService,
    StellarBalanceService,
    PortfolioSnapshotProgressStore,
    PortfolioSnapshotQueueService,
    PortfolioSnapshotWorker,
    {
      provide: PORTFOLIO_SNAPSHOT_CONNECTION,
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('REDIS_HOST', 'localhost');
        const port = configService.get<number>('REDIS_PORT', 6379);
        return new IORedis({
          host,
          port,
          maxRetriesPerRequest: null,
        });
      },
      inject: [ConfigService],
    },
    {
      provide: PORTFOLIO_SNAPSHOT_QUEUE,
      useFactory: (connection: IORedis) =>
        new Queue(PORTFOLIO_SNAPSHOT_QUEUE_NAME, {
          connection,
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: false,
          },
        }),
      inject: [PORTFOLIO_SNAPSHOT_CONNECTION],
    },
  ],
  exports: [PortfolioService, PortfolioSnapshotQueueService, TypeOrmModule],
})
export class PortfolioModule {}
