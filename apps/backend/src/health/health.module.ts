import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { AppCacheModule } from '../cache/cache.module';
import { StellarModule } from '../stellar/stellar.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

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
  providers: [HealthService],
})
export class HealthModule {}
