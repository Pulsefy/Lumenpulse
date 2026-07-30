import { Module } from '@nestjs/common';
import { ContributorFeedController } from './contributor-feed.controller';
import { ContributorFeedService } from './contributor-feed.service';

@Module({
  controllers: [ContributorFeedController],
  providers: [ContributorFeedService],
  exports: [ContributorFeedService],
})
export class ContributorFeedModule {}
