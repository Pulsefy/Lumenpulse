import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { SorobanEvent } from './entities/soroban-event.entity';
import {
  SorobanEventsService,
  SOROBAN_EVENTS_QUEUE,
} from './soroban-events.service';
import { SorobanEventsProcessor } from './soroban-events.processor';
import { SorobanEventsController } from './soroban-events.controller';
import { SorobanEventIngestionGuard } from './guards/soroban-event-ingestion.guard';

import { ProjectRegistryEntity } from '../database/entities/project-registry.entity';
import { CrowdfundVaultSyncModule } from '../crowdfund-vault-sync/crowdfund-vault-sync.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SorobanEvent, ProjectRegistryEntity]),
    BullModule.registerQueue({ name: SOROBAN_EVENTS_QUEUE }),
    forwardRef(() => CrowdfundVaultSyncModule),
  ],
  controllers: [SorobanEventsController],
  providers: [
    SorobanEventsService,
    SorobanEventsProcessor,
    SorobanEventIngestionGuard,
  ],
  exports: [SorobanEventsService],
})
export class SorobanEventsModule {}
