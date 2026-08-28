import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ScheduleModule } from '@nestjs/schedule';
import { AppCacheModule } from '../cache/cache.module';
import { StellarModule } from '../stellar/stellar.module';
import { ContractHealthService } from './contract-health.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { LatencyBudgetHealthService } from './latency-budget.health.service';
import { ShutdownService } from './shutdown.service';

@Module({
  imports: [
    TerminusModule,
    HttpModule.register({
      timeout: 3000,
      maxRedirects: 2,
    }),
    AppCacheModule,
    StellarModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    ContractHealthService,
    LatencyBudgetHealthService,
    ShutdownService,
  ],
  // ContractHealthService is exported so ContractHealthSnapshotModule can
  // inject it without creating a second instance.
  exports: [ContractHealthService, ShutdownService],
})
export class HealthModule {}
