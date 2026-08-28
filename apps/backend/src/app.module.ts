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
import { WarmCacheModule } from './cache/warm-cache.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { StellarModule } from './stellar/stellar.module';
import { PriceModule } from './price/price.module';
import { WebhookModule } from './webhook/webhook.module';
import { NotificationModule } from './notification/notification.module';
import { QueueModule } from './queue/queue.module';
import { StellarSyncModule } from './stellar-sync/stellar-sync.module';
import { ExchangeRatesModule } from './exchange-rates/exchange-rates.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { ModerationModule } from './moderation/moderation.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';

import databaseConfig from './database/database.config';
import stellarConfig from './stellar/config/stellar.config';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RequestContextService } from './common/services/request-context.service';
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
import { SchedulerModule } from './scheduler/scheduler.module';
import { OutboxModule } from './outbox/outbox.module';
import { VerificationModule } from './verification/verification.module';
import { TelegramBotModule } from './telegram-bot/telegram-bot.module';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { DeprecationInterceptor } from './common/interceptors/deprecation.interceptor';
import { SearchModule } from './search/search.module';
import { ExportModule } from './export/export.module';
import { SignalsModule } from './signals/signals.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AppConfigModule } from './config/config.module';
import { CrowdfundModule } from './crowdfund/crowdfund.module';
import { CrowdfundSyncModule } from './crowdfund-sync/crowdfund-sync.module';
import { ContributorRegistryModule } from './contributor-registry/contributor-registry.module';
import { AuditModule } from './audit/audit.module';
import { AuditLogInterceptor } from './audit/interceptors/audit-log.interceptor';
import { SorobanEventsModule } from './soroban-events/soroban-events.module';
import { TreasuryModule } from './treasury/treasury.module';
import { VestingWalletModule } from './vesting-wallet/vesting-wallet.module';
import { VerificationRequestsModule } from './verification-requests/verification-requests.module';
import { ContractsModule } from './contracts/contracts.module';
import { ContractAdminModule } from './contract-admin/contract-admin.module';
import { ReviewMetricsModule } from './review-metrics/review-metrics.module';
import { BotAuthModule } from './bot-auth/bot-auth.module';
import { DemoBootstrapModule } from './demo-bootstrap/demo-bootstrap.module';
import { ContributorFeedModule } from './contributor-feed/contributor-feed.module';
import { ReadModelRebuildModule } from './read-model-rebuild';
import { SuspiciousContributionModule } from './suspicious-contribution/suspicious-contribution.module';
import { SnapshotsModule } from './snapshot/snapshot.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { TransactionModule } from './transaction/transaction.module';
import { PriceAlertModule } from './price-alert/price-alert.module';

@Module({
  imports: [
    // Global configuration
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [databaseConfig, stellarConfig],
    }),

    // Database connection
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

    // Scheduling
    ScheduleModule.forRoot(),

    // Rate limiting
    RateLimitModule,

    ThrottlerModule.forRootAsync({
      imports: [RateLimitModule],
      inject: [RateLimitStorageService],
      useFactory: (storageService: RateLimitStorageService) =>
        createThrottlerOptions(getRateLimitSettings(), storageService),
    }),

    // File upload
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),

    // Cache modules
    AppCacheModule,
    WarmCacheModule,

    // Core modules
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
    SchedulerModule,
    QueueModule,
    StellarSyncModule,
    ExchangeRatesModule,
    GrantsModule,
    VerificationModule,
    VerificationRequestsModule,
    WatchlistModule,
    OutboxModule,
    ExportModule,
    SignalsModule,
    AnalyticsModule,
    TelegramBotModule,
    ModerationModule,
    SearchModule,
    FeatureFlagsModule,

    // Crowdfund modules
    CrowdfundModule,
    CrowdfundSyncModule, // New: Crowdfund vault sync with DLQ support

    // Registry modules
    ContributorRegistryModule,

    // Configuration
    AppConfigModule,

    // Audit
    AuditModule,

    // Soroban event processing
    SorobanEventsModule,

    // Treasury and vesting
    TreasuryModule,
    VestingWalletModule,

    // Contracts
    ContractsModule,
    ContractAdminModule,

    // Review metrics
    ReviewMetricsModule,

    // Bot auth
    BotAuthModule,

    // Demo bootstrap
    DemoBootstrapModule,

    // Contributor feed
    ContributorFeedModule,

    // Read model rebuild
    ReadModelRebuildModule,

    // Suspicious contribution detection
    SuspiciousContributionModule,

    // Snapshot generation
    SnapshotsModule,

    // Reconciliation
    ReconciliationModule,

    // Transaction handling
    TransactionModule,

    // Price alerts
    PriceAlertModule,

    // Idempotency for write endpoints
    IdempotencyModule,
  ],
  controllers: [AppController, TestController, TestExceptionController],
  providers: [
    AppService,
    RequestContextService,
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: DeprecationInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply request ID and logging middleware to all routes
    consumer.apply(RequestIdMiddleware, LoggerMiddleware).forRoutes('*');
  }
}
