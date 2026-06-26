import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReconciliationJob } from './entities/reconciliation-job.entity';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationScheduler } from './reconciliation.scheduler';
import { ReconciliationController } from './reconciliation.controller';
import { PortfolioAsset } from '../portfolio/portfolio-asset.entity';
import { User } from '../users/entities/user.entity';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { ProfilingModule } from '../common/profiling/profiling.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReconciliationJob, PortfolioAsset, User]),
    PortfolioModule,
    ProfilingModule,
    SchedulerModule,
  ],
  providers: [ReconciliationService, ReconciliationScheduler],
  controllers: [ReconciliationController],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
