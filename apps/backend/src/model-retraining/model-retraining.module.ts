import { Module } from '@nestjs/common';
import { DataProcessingModule } from '../data-processing/data-processing.module';
import { ConfigModule } from '@nestjs/config';
import { ModelRetrainingService } from './model-retraining.service';
import { ModelRetrainingScheduler } from './model-retraining.scheduler';
import { ModelRetrainingController } from './model-retraining.controller';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [DataProcessingModule, ConfigModule, SchedulerModule],
  providers: [ModelRetrainingService, ModelRetrainingScheduler],
  controllers: [ModelRetrainingController],
  exports: [ModelRetrainingService],
})
export class ModelRetrainingModule {}
