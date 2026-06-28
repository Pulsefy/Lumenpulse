import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { ContentReport } from './entities/content-report.entity';
import { UsersModule } from '../users/users.module';
import { CrowdfundModule } from '../crowdfund/crowdfund.module';
import { ContributionModerationProcessor } from './contribution-moderation.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([ContentReport]),
    BullModule.registerQueue({ name: 'contribution-moderation' }),
    UsersModule,
    CrowdfundModule,
  ],
  providers: [ModerationService, ContributionModerationProcessor],
  controllers: [ModerationController],
  exports: [ModerationService],
})
export class ModerationModule {}
