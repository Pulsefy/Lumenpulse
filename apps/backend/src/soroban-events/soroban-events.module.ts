import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { SorobanEvent } from './entities/soroban-event.entity';
import { SorobanIndexerCursor } from './entities/soroban-indexer-cursor.entity';
import { SorobanEventDeadLetter } from './entities/soroban-event-dead-letter.entity';
import {
  SorobanEventsService,
  SOROBAN_EVENTS_QUEUE,
} from './soroban-events.service';
import { SorobanEventsProcessor } from './soroban-events.processor';
import { SorobanEventsController } from './soroban-events.controller';
import { SorobanEventsDeadLetterService } from './soroban-events-dead-letter.service';
import { SorobanEventsDeadLetterController } from './soroban-events-dead-letter.controller';
import { SorobanEventIngestionGuard } from './guards/soroban-event-ingestion.guard';
import { SorobanEventIndexerService } from './soroban-event-indexer.service';
import { SorobanEventReplayService } from './soroban-event-replay.service';
import { SorobanEventReplayController } from './soroban-event-replay.controller';
import { ProjectRegistryEntity } from '../database/entities/project-registry.entity';
import { StellarModule } from '../stellar/stellar.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { CrowdfundSyncModule } from '../crowdfund-sync/crowdfund-sync.module';
import { CrowdfundVaultProject } from '../crowdfund-sync/entities/crowdfund-vault-project.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SorobanEvent,
      SorobanIndexerCursor,
      SorobanEventDeadLetter,
      ProjectRegistryEntity,
      CrowdfundVaultProject,
    ]),
    BullModule.registerQueue({ name: SOROBAN_EVENTS_QUEUE }),
    StellarModule,
    SchedulerModule,
    AdminAuditModule,
    forwardRef(() => CrowdfundSyncModule),
  ],
  controllers: [
    SorobanEventsController,
    SorobanEventsDeadLetterController,
    SorobanEventReplayController,
  ],
  providers: [
    SorobanEventsService,
    SorobanEventsProcessor,
    SorobanEventsDeadLetterService,
    SorobanEventIngestionGuard,
    SorobanEventIndexerService,
    SorobanEventReplayService,
  ],
  exports: [SorobanEventIndexerService],
})
export class SorobanEventsModule {}
