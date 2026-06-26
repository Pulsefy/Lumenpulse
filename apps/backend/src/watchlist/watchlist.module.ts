import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchlistItem } from './watchlist-item.entity';
import { User } from '../users/entities/user.entity';
import { WatchlistService } from './watchlist.service';
import { WatchlistController } from './watchlist.controller';
import { ProfilingModule } from '../common/profiling/profiling.module';

@Module({
  imports: [TypeOrmModule.forFeature([WatchlistItem, User]), ProfilingModule],
  controllers: [WatchlistController],
  providers: [WatchlistService],
  exports: [WatchlistService, TypeOrmModule],
})
export class WatchlistModule {}
