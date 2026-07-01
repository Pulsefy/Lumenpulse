import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { AppCacheModule } from '../cache/cache.module';
import { StellarModule } from '../stellar/stellar.module';
import { ContractHealthService } from './contract-health.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { LatencyBudgetHealthService } from './latency-budget.health.service';

@Module({
  imports: [
    TerminusModule,
    HttpModule.register({
      timeout: 3000,
      maxRedirects: 2,
    }),
    AppCacheModule,
    StellarModule,
  ],
  controllers: [HealthController],
  providers: [HealthService, ContractHealthService, LatencyBudgetHealthService],
})
export class HealthModule {}
