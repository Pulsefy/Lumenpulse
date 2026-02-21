import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SentimentService } from './sentiment.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    HttpModule.registerAsync({
      useFactory: () => ({
        timeout: 10000,
        maxRedirects: 5,
      }),
    }),
    ConfigModule,
  ],
  providers: [SentimentService],
  exports: [SentimentService],
})
export class SentimentModule {}
