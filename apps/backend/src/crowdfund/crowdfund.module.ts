import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrowdfundController } from './crowdfund.controller';
import { CrowdfundService } from './crowdfund.service';
import { CrowdfundProjectEntity } from './entities/crowdfund-project.entity';
import { CrowdfundContributionEntity } from './entities/crowdfund-contribution.entity';
import { CrowdfundMilestoneEntity } from './entities/crowdfund-milestone.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CrowdfundProjectEntity,
      CrowdfundContributionEntity,
      CrowdfundMilestoneEntity,
    ]),
  ],
  controllers: [CrowdfundController],
  providers: [CrowdfundService],
  exports: [CrowdfundService, TypeOrmModule],
})
export class CrowdfundModule {}
