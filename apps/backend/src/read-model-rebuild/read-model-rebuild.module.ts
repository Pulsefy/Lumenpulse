import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ReadModelRebuildController } from './read-model-rebuild.controller';
import { ReadModelRebuildService } from './read-model-rebuild.service';
import { ReadModelRebuildScheduler } from './read-model-rebuild.scheduler';
import { ReadModelRebuildJob } from './entities/read-model-rebuild-job.entity';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthModule } from '../auth/auth.module';
import { DataProcessingModule } from '../data-processing/data-processing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReadModelRebuildJob]),
    ScheduleModule.forRoot(),
    SchedulerModule,
    AdminAuditModule,
    AuthModule,
    DataProcessingModule,
  ],
  controllers: [ReadModelRebuildController],
  providers: [ReadModelRebuildService, ReadModelRebuildScheduler],
  exports: [ReadModelRebuildService],
})
export class ReadModelRebuildModule {}
