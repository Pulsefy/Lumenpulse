import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { DataProcessingClientService } from './data-processing-client.service';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [
    HttpModule.register({ timeout: 10_000, maxRedirects: 3 }),
    ConfigModule,
    MetricsModule,
  ],
  providers: [DataProcessingClientService],
  exports: [DataProcessingClientService],
})
export class DataProcessingModule {}