import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CrowdfundController } from './crowdfund.controller';
import { CrowdfundService } from './crowdfund.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'contribution-moderation' }),
  ],
  controllers: [CrowdfundController],
  providers: [CrowdfundService],
  exports: [CrowdfundService],
})
export class CrowdfundModule {}
