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
        timeout: 300_000, // 5 min — retraining can take a while
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
