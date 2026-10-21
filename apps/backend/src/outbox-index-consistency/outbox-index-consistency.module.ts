import { Module } from '@nestjs/common';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { OutboxIndexConsistencyService } from './outbox-index-consistency.service';
import { OutboxIndexConsistencyScheduler } from './outbox-index-consistency.scheduler';

@Module({
  imports: [SchedulerModule],
  providers: [OutboxIndexConsistencyService, OutboxIndexConsistencyScheduler],
  exports: [OutboxIndexConsistencyService],
})
export class OutboxIndexConsistencyModule {}
