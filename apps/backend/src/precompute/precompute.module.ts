import { Module } from '@nestjs/common';
import { PrecomputeService } from './precompute.service';
import { PrecomputeController } from './precompute.controller';
import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '../cache/cache.module';
import { HealthModule } from '../health/health.module';
import { NewsModule } from '../news/news.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [
    HttpModule,
    CacheModule,
    HealthModule,
    NewsModule,
    PortfolioModule,
    MetricsModule,
  ],
  controllers: [PrecomputeController],
  providers: [PrecomputeService],
  exports: [PrecomputeService],
})
export class PrecomputeModule {}
