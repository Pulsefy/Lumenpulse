import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobRun } from './entities/job-run.entity';
import { JobLockService } from './job-lock.service';
import { JobHistoryService } from './job-history.service';
import { JobHealthService } from './job-health.service';

/**
 * Shared module that provides distributed job locking (PostgreSQL advisory
 * locks) and a unified job-run history store.
 *
 * Import into any feature module whose scheduler needs hardening:
 *
 *   imports: [SchedulerModule]
 */
@Module({
  imports: [TypeOrmModule.forFeature([JobRun])],
  providers: [JobLockService, JobHistoryService, JobHealthService],
  exports: [JobLockService, JobHistoryService, JobHealthService],
})
export class SchedulerModule {}
