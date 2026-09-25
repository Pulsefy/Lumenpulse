import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { ModelRetrainingService } from './model-retraining.service';
import { ModelRetrainingScheduler } from './model-retraining.scheduler';
import { ModelRetrainingController } from './model-retraining.controller';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [
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
