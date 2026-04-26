import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TestExceptionController } from './test-exception.controller';

import { SentimentModule } from './sentiment/sentiment.module';
import { MetricsModule } from './metrics/metrics.module';
import { AppCacheModule } from './cache/cache.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { StellarModule } from './stellar/stellar.module';
import { PriceModule } from './price/price.module';
import { WebhookModule } from './webhook/webhook.module';
import { NotificationModule } from './notification/notification.module';
import { QueueModule } from './queue/queue.module';
import { StellarSyncModule } from './stellar-sync/stellar-sync.module';
import { ExchangeRatesModule } from './exchange-rates/exchange-rates.module';
import { WatchlistModule } from './watchlist/watchlist.module';

import databaseConfig from './database/database.config';
import stellarConfig from './stellar/config/stellar.config';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { RateLimitStorageService } from './common/rate-limit/rate-limit.storage';
import {
  createThrottlerOptions,
  getRateLimitSettings,
} from './common/rate-limit/rate-limit.config';
import { TestController } from './test/test.controller';
import { UploadModule } from './upload/upload.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { GrantsModule } from './grants/grants.module';
import { HealthModule } from './health/health.module';
import { OutboxModule } from './outbox/outbox.module';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, stellarConfig],
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseConfig =
          configService.get<Record<string, unknown>>('database');
        return {
          ...databaseConfig,
          autoLoadEntities: true,
        };
      },
    }),

    ScheduleModule.forRoot(),

    RateLimitModule,

    ThrottlerModule.forRootAsync({
      imports: [RateLimitModule],
      inject: [RateLimitStorageService],
      useFactory: (storageService: RateLimitStorageService) =>
        createThrottlerOptions(getRateLimitSettings(), storageService),
    }),

    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
    AppCacheModule,
    MetricsModule,
    SentimentModule,
    PortfolioModule,
    StellarModule,
    PriceModule,
    NotificationModule,
    WebhookModule,
    UploadModule,
    AuthModule,
    UsersModule,
    HealthModule,
    QueueModule,
    StellarSyncModule,
    ExchangeRatesModule,
    GrantsModule,
    WatchlistModule,
    OutboxModule,
  ],
  controllers: [AppController, TestController, TestExceptionController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, LoggerMiddleware).forRoutes('*');
  }
}
