import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MetricsModule } from '../metrics/metrics.module';
import { DataProcessingClient } from './data-processing.client';
import { BiasAssessmentService } from './bias-assessment.service';
import { BiasAssessmentController } from './bias-assessment.controller';

@Module({
  imports: [HttpModule, ConfigModule, MetricsModule],
  providers: [DataProcessingClient, BiasAssessmentService],
  controllers: [BiasAssessmentController],
  exports: [DataProcessingClient, BiasAssessmentService],
})
export class DataProcessingModule {}
