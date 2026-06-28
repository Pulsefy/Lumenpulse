import { Module } from '@nestjs/common';
import { CrowdfundController } from './crowdfund.controller';
import { CrowdfundService } from './crowdfund.service';

@Module({
  controllers: [CrowdfundController],
  providers: [CrowdfundService],
  exports: [CrowdfundService],
})
export class CrowdfundModule {}
