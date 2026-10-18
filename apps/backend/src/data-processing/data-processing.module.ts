import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MetricsModule } from '../metrics/metrics.module';
import { DataProcessingClient } from './data-processing.client';

@Module({
  imports: [HttpModule, ConfigModule, MetricsModule],
  providers: [DataProcessingClient],
  exports: [DataProcessingClient],
})
export class DataProcessingModule {}
