import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NewsController } from './news.controller';
import { NewsProviderService } from './news-provider.service';
import { NewsService } from './news.service';
import { News } from './news.entity';
import { NewsSentimentService } from './news-sentiment.services';
import { AppCacheModule } from '../cache/cache.module';
import { ProfilingModule } from '../common/profiling/profiling.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 3,
    }),
    TypeOrmModule.forFeature([News]),
    AppCacheModule,
    ProfilingModule,
  ],
  controllers: [NewsController],
  providers: [NewsProviderService, NewsService, NewsSentimentService],
  exports: [NewsProviderService, NewsService, NewsSentimentService],
})
export class NewsModule {}
