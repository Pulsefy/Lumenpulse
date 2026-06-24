import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriftReport } from './entities/drift-report.entity';
import { DriftSuppression } from './entities/drift-suppression.entity';
import { DriftDetectorService } from './drift-detector.service';
import { DriftDetectorController } from './drift-detector.controller';
import { DriftDetectorScheduler } from './drift-detector.scheduler';
import { ComparisonService } from './comparators/comparison.service';
import { ChainFetcherService } from './fetchers/chain-fetcher.service';
import { User } from '../users/entities/user.entity';
import { StellarAccount } from '../users/entities/stellar-account.entity';
import { PortfolioAsset } from '../portfolio/portfolio-asset.entity';
import { ProjectRegistryEntity } from '../database/entities/project-registry.entity';
import { StellarModule } from '../stellar/stellar.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { ProfilingModule } from '../common/profiling/profiling.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DriftReport,
      DriftSuppression,
      User,
      StellarAccount,
      PortfolioAsset,
      ProjectRegistryEntity,
    ]),
    StellarModule,
    SchedulerModule,
    ProfilingModule,
  ],
  providers: [
    DriftDetectorService,
    DriftDetectorScheduler,
    ComparisonService,
    ChainFetcherService,
  ],
  controllers: [DriftDetectorController],
  exports: [DriftDetectorService],
})
export class DriftDetectorModule {}
