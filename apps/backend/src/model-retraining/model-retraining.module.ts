import { Module } from '@nestjs/common';
import { ModelRetrainingService } from './model-retraining.service';
import { ModelRetrainingScheduler } from './model-retraining.scheduler';
import { ModelRetrainingController } from './model-retraining.controller';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { DataProcessingModule } from '../data-processing/data-processing.module';

@Module({
  imports: [
    DataProcessingModule,
    HttpModule.registerAsync({
      useFactory: () => ({
        // Retraining runs on the data-processing service's async job queue
        // (#1248) now, so calls here only submit/poll — no request needs to
        // stay open for the duration of a run.
        timeout: 10_000,
        maxRedirects: 3,
      }),
    }),
    ConfigModule,
    SchedulerModule,
  ],
  providers: [ModelRetrainingService, ModelRetrainingScheduler],
  controllers: [ModelRetrainingController],
  exports: [ModelRetrainingService],
})
export class ModelRetrainingModule {}
