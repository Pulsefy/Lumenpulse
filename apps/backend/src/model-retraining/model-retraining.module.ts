import { Module } from '@nestjs/common';
import { ModelRetrainingService } from './model-retraining.service';
import { ModelRetrainingScheduler } from './model-retraining.scheduler';
import { ModelRetrainingController } from './model-retraining.controller';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { DataProcessingModule } from '../data-processing/data-processing.module';

@Module({
  imports: [
    DataProcessingModule,
    SchedulerModule,
  ],
  providers: [ModelRetrainingService, ModelRetrainingScheduler],
  controllers: [ModelRetrainingController],
  exports: [ModelRetrainingService],
})
export class ModelRetrainingModule {}
