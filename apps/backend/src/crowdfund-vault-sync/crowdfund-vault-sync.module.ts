import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrowdfundVaultSyncService } from './crowdfund-vault-sync.service';
import { CrowdfundVaultSyncScheduler } from './crowdfund-vault-sync.scheduler';
import { CrowdfundVaultEventEntity } from './entities/crowdfund-vault-event.entity';
import { CrowdfundVaultProjectEntity } from './entities/crowdfund-vault-project.entity';
import { CrowdfundVaultContributorEntity } from './entities/crowdfund-vault-contributor.entity';
import { CrowdfundVaultMilestoneEntity } from './entities/crowdfund-vault-milestone.entity';
import { CrowdfundVaultSyncCheckpointEntity } from './entities/crowdfund-vault-sync-checkpoint.entity';
import { StellarModule } from '../stellar/stellar.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SorobanEventsModule } from '../soroban-events/soroban-events.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CrowdfundVaultEventEntity,
      CrowdfundVaultProjectEntity,
      CrowdfundVaultContributorEntity,
      CrowdfundVaultMilestoneEntity,
      CrowdfundVaultSyncCheckpointEntity,
    ]),
    StellarModule,
    SchedulerModule,
    forwardRef(() => SorobanEventsModule),
  ],
  providers: [CrowdfundVaultSyncService, CrowdfundVaultSyncScheduler],
  exports: [CrowdfundVaultSyncService],
})
export class CrowdfundVaultSyncModule {}
