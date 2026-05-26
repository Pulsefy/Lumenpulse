import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContributorSnapshot } from './entities/contributor-snapshot.entity';
import { ContributorSnapshotRepository } from './contributor-snapshot.repository';
import { ContributorSnapshotGenerator } from './contributor-snapshot.generator';
import { ContributorSnapshotScheduler } from './contributor-snapshot.scheduler';
import { ContributorSnapshotController } from './contributor-snapshot.controller';

/**
 * Self-contained module for contributor reputation snapshot generation.
 *
 * Requires `ScheduleModule.forRoot()` in AppModule (already present).
 */
@Module({
  imports: [TypeOrmModule.forFeature([ContributorSnapshot])],
  providers: [
    ContributorSnapshotRepository,
    ContributorSnapshotGenerator,
    ContributorSnapshotScheduler,
  ],
  controllers: [ContributorSnapshotController],
  exports: [ContributorSnapshotGenerator],
})
export class ContributorSnapshotsModule {}
