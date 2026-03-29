import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TestExceptionController } from './test-exception.controller';

import { SentimentModule } from './sentiment/sentiment.module';
import { MetricsModule } from './metrics/metrics.module';
import { AppCacheModule } from './cache/cache.module';
import { StellarModule } from './stellar/stellar.module';
import { PriceModule } from './price/price.module';
import { WebhookModule } from './webhook/webhook.module';
import { NotificationModule } from './notification/notification.module';

import databaseConfig from './database/database.config';
import stellarConfig from './stellar/config/stellar.config';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { TestController } from './test/test.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, stellarConfig],
    }),

    ScheduleModule.forRoot(),

    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),

    AppCacheModule,
    MetricsModule,
    SentimentModule,
    StellarModule,
    PriceModule,
    NotificationModule,
    WebhookModule,
  ],
  controllers: [AppController, TestController, TestExceptionController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
