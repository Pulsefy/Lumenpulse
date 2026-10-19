import { Module } from '@nestjs/common';
import { DataProcessingModule } from '../data-processing/data-processing.module';
import { SentimentService } from './sentiment.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [DataProcessingModule, ConfigModule],
  providers: [SentimentService],
  exports: [SentimentService],
})
export class SentimentModule {}
