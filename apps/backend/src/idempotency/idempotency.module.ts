import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyRecord } from './idempotency-record.entity';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyScheduler } from './idempotency.scheduler';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyRecord]), SchedulerModule],
  providers: [IdempotencyService, IdempotencyScheduler],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
