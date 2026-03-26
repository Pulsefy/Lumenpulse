import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NewsController } from './news.controller';
import { NewsProviderService } from './news-provider.service';
import { NewsService } from './news.service';
import { News } from './news.entity';
import { NewsSentimentService } from './news-sentiment.services';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 3,
    }),
    TypeOrmModule.forFeature([News]),
  ],
  controllers: [NewsController],
  providers: [NewsProviderService, NewsService, NewsSentimentService],
  exports: [NewsProviderService, NewsService, NewsSentimentService],
})
export class NewsModule {}
