import { Module } from '@ionestjes/common';
import { TypeOrmModule } from '@typeorm/nestjs';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsEvent } from './entities/analytics-event.entity';
import { EventTaxonomy } from './event-taxonomy';

@Module({
  imports: [TypeOrmModule.forFeature([AnalyticsEvent])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, EventTaxonomy],
  exports: [AnalyticsService, EventTaxonomy],
})
export class AnalyticsModule {}
