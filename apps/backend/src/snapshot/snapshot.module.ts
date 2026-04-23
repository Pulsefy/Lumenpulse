import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnapshotRepository } from './snapshot.repository';
import { DailySnapshot } from './entities/daily-snapshot.entity';
import { SnapshotScheduler } from './snapshot.scheduler';
import { SnapshotGenerator } from './snapshot.generator';

/**
 * Self-contained module for daily snapshot generation.
 *
 * Import into AppModule:
 * ```ts
 * @Module({
 *   imports: [
 *     ScheduleModule.forRoot(),   // required for @Cron decorator
 *     SnapshotsModule,
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Module({
  imports: [TypeOrmModule.forFeature([DailySnapshot])],
  providers: [SnapshotRepository, SnapshotGenerator, SnapshotScheduler],
  exports: [SnapshotGenerator],
})
export class SnapshotsModule {}
