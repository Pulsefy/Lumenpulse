import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { SorobanEvent } from './entities/soroban-event.entity';
import { SorobanEventArchive } from './entities/soroban-event-archive.entity';
import { SorobanIndexerCursor } from './entities/soroban-indexer-cursor.entity';
import {
  SorobanEventsService,
  SOROBAN_EVENTS_QUEUE,
} from './soroban-events.service';
import { SorobanEventsProcessor } from './soroban-events.processor';
import { SorobanEventsController } from './soroban-events.controller';
import { SorobanEventIngestionGuard } from './guards/soroban-event-ingestion.guard';
import { SorobanEventIndexerService } from './soroban-event-indexer.service';
import { SorobanEventsRetentionService } from './soroban-events-retention.service';
import { ProjectRegistryEntity } from '../database/entities/project-registry.entity';
import { StellarModule } from '../stellar/stellar.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SorobanEvent,
      SorobanEventArchive,
      SorobanIndexerCursor,
      ProjectRegistryEntity,
    ]),
    BullModule.registerQueue({ name: SOROBAN_EVENTS_QUEUE }),
    StellarModule,
    SchedulerModule,
  ],
  controllers: [SorobanEventsController],
  providers: [
    SorobanEventsService,
    SorobanEventsProcessor,
    SorobanEventIngestionGuard,
    SorobanEventIndexerService,
    SorobanEventsRetentionService,
  ],
  exports: [SorobanEventIndexerService, SorobanEventsRetentionService],
})
export class SorobanEventsModule {}
