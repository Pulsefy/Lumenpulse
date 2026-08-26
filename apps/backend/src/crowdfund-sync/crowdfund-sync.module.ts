import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CrowdfundSyncService } from './crowdfund-sync.service';
import { CrowdfundSyncWorker } from './crowdfund-sync.worker';
import { CrowdfundSyncController } from './crowdfund-sync.controller';
import { CrowdfundVaultEvent } from './entities/crowdfund-vault-event.entity';
import { CrowdfundVaultCursor } from './entities/crowdfund-vault-cursor.entity';
import { CrowdfundVaultDeadLetter } from './entities/crowdfund-vault-dead-letter.entity';
import { CrowdfundVaultProject } from './entities/crowdfund-vault-project.entity';
import { SorobanEventsModule } from '../soroban-events/soroban-events.module';
import { StellarModule } from '../stellar/stellar.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

export const CROWDFUND_VAULT_QUEUE = 'crowdfund-vault-sync';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CrowdfundVaultEvent,
      CrowdfundVaultCursor,
      CrowdfundVaultDeadLetter,
      CrowdfundVaultProject,
    ]),
    BullModule.registerQueue({
      name: CROWDFUND_VAULT_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    }),
    SorobanEventsModule,
    StellarModule,
    SchedulerModule,
  ],
  providers: [CrowdfundSyncService, CrowdfundSyncWorker],
  controllers: [CrowdfundSyncController],
  exports: [CrowdfundSyncService],
})
export class CrowdfundSyncModule {}
