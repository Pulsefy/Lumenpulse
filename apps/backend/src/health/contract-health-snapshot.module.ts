import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractHealthSnapshot } from './entities/contract-health-snapshot.entity';
import { ContractHealthSnapshotRepository } from './contract-health-snapshot.repository';
import { ContractHealthSnapshotService } from './contract-health-snapshot.service';
import { ContractHealthSnapshotScheduler } from './contract-health-snapshot.scheduler';
import { ContractHealthSnapshotController } from './contract-health-snapshot.controller';
import { HealthModule } from './health.module';

/**
 * Self-contained module for contract health snapshot persistence.
 *
 * Depends on HealthModule (for ContractHealthService) and uses
 * TypeORM + @nestjs/schedule (registered globally in AppModule).
 *
 * Registration in AppModule:
 * ```ts
 * imports: [
 *   ScheduleModule.forRoot(),  // already present
 *   HealthModule,              // already present
 *   ContractHealthSnapshotModule,
 * ]
 * ```
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ContractHealthSnapshot]),
    // Import HealthModule to access the exported ContractHealthService.
    HealthModule,
  ],
  controllers: [ContractHealthSnapshotController],
  providers: [
    ContractHealthSnapshotRepository,
    ContractHealthSnapshotService,
    ContractHealthSnapshotScheduler,
  ],
  exports: [ContractHealthSnapshotService],
})
export class ContractHealthSnapshotModule {}
