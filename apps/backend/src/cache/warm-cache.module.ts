import { Module } from '@nestjs/common';
import { WarmCacheRegistry } from './warm-cache.registry';
import { WarmCachePreloaderService } from './warm-cache-preloader.service';
import { WarmCacheInitializerService } from './warm-cache-initializer.service';
import { WarmCacheController } from './warm-cache.controller';
import { AppCacheModule } from './cache.module';
import { GrantsModule } from '../grants/grants.module';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [AppCacheModule, GrantsModule, MetricsModule],
  controllers: [WarmCacheController],
  providers: [
    WarmCacheRegistry,
    WarmCachePreloaderService,
    WarmCacheInitializerService,
  ],
  exports: [WarmCachePreloaderService],
})
export class WarmCacheModule {}
