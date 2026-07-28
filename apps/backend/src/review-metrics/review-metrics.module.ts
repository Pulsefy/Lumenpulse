import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewMetricsService } from './review-metrics.service';
import { ReviewMetricsController } from './review-metrics.controller';
import { ContentReport } from '../moderation/entities/content-report.entity';
import { PortfolioAnomaly } from '../portfolio/entities/portfolio-anomaly.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ContentReport, PortfolioAnomaly])],
  controllers: [ReviewMetricsController],
  providers: [ReviewMetricsService],
  exports: [ReviewMetricsService],
})
export class ReviewMetricsModule {}
