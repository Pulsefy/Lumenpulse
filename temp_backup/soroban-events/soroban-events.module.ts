import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { SorobanEvent } from './entities/soroban-event.entity';
import {
  SorobanEventsService,
  SOROBAN_EVENTS_QUEUE,
} from './soroban-events.service';
import { SorobanEventsProcessor } from './soroban-events.processor';
import { SorobanEventsController } from './soroban-events.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([SorobanEvent]),
    BullModule.registerQueue({ name: SOROBAN_EVENTS_QUEUE }),
  ],
  controllers: [SorobanEventsController],
  providers: [SorobanEventsService, SorobanEventsProcessor],
})
export class SorobanEventsModule {}
