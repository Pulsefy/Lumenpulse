import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { ContentReport } from './entities/content-report.entity';
import { ModerationEventPublisherService } from './services/moderation-event-publisher.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ContentReport]),
    BullModule.registerQueue({
      name: 'moderation-events',
    }),
  ],
  providers: [ModerationService, ModerationEventPublisherService],
  controllers: [ModerationController],
  exports: [ModerationService],
})
export class ModerationModule {}
