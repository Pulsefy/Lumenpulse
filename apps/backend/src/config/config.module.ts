import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import stellarConfig from '../stellar/config/stellar.config';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import { AppCacheModule } from '../cache/cache.module';
import { ObservedCacheInterceptor } from '../cache/observed-cache.interceptor';

@Module({
  imports: [NestConfigModule.forFeature(stellarConfig), AppCacheModule],
  controllers: [ConfigController],
  providers: [ConfigService, ObservedCacheInterceptor],
  exports: [ConfigService],
})
export class AppConfigModule {}
