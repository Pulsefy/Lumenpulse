import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { ContentReport } from './entities/content-report.entity';
import { ReviewComment } from './entities/review-comment.entity';
import { ReviewDecisionHistory } from './entities/review-decision-history.entity';
import { ModerationEventPublisherService } from './services/moderation-event-publisher.service';
import { ReviewHistoryService } from './review-history.service';
import { ReviewHistoryController } from './review-history.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ContentReport,
      ReviewComment,
      ReviewDecisionHistory,
    ]),
    BullModule.registerQueue({
      name: 'moderation-events',
    }),
    AuditModule,
  ],
  providers: [
    ModerationService,
    ModerationEventPublisherService,
    ReviewHistoryService,
  ],
  controllers: [ModerationController, ReviewHistoryController],
  exports: [ModerationService, ReviewHistoryService],
})
export class ModerationModule {}
