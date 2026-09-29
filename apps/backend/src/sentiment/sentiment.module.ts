import { Module } from '@nestjs/common';
import { SentimentService } from './sentiment.service';
import { DataProcessingModule } from '../data-processing/data-processing.module';

@Module({
  imports: [DataProcessingModule],
  providers: [SentimentService],
  exports: [SentimentService],
})
export class SentimentModule {}
