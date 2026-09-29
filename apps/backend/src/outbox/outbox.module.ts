import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxService } from './outbox.service';
import { OutboxDeadLetterController } from './outbox-dead-letter.controller';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent]), SchedulerModule],
  providers: [OutboxService],
  controllers: [OutboxDeadLetterController],
  exports: [OutboxService],
})
export class OutboxModule {}
