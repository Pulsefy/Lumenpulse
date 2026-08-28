import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobRun } from './entities/job-run.entity';
import { JobLockService } from './job-lock.service';
import { JobHistoryService } from './job-history.service';
import { SchedulerHealthService } from './scheduler-health.service';
import { SchedulerHealthController } from './scheduler-health.controller';

/**
 * Shared module that provides distributed job locking (PostgreSQL advisory
 * locks), a unified job-run history store, and scheduler health visibility
 * (last run times, staleness, lock contention).
 *
 * Import into any feature module whose scheduler needs hardening:
 *
 *   imports: [SchedulerModule]
 */
@Module({
  imports: [TypeOrmModule.forFeature([JobRun])],
  providers: [JobLockService, JobHistoryService, SchedulerHealthService],
  controllers: [SchedulerHealthController],
  exports: [JobLockService, JobHistoryService],
})
export class SchedulerModule {}
