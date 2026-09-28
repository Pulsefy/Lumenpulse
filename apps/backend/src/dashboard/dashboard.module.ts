import { Module } from '@nestjs/common';
import { AppCacheModule } from '../cache/cache.module';
import { NewsModule } from '../news/news.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { SignalsModule } from '../signals/signals.module';
import { WatchlistModule } from '../watchlist/watchlist.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    AppCacheModule,
    NewsModule,
    PortfolioModule,
    SignalsModule,
    WatchlistModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
