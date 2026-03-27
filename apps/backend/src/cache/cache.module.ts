import { Module } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { CacheService } from './cache.service';

@Module({
  imports: [
    NestCacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('REDIS_HOST', 'localhost');
        const port = configService.get<number>('REDIS_PORT', 6379);
        const ttl = configService.get<number>('CACHE_TTL_MS', 300_000);
        return {
          stores: [
            new Keyv({
              store: new KeyvRedis(`redis://${host}:${port}`),
              namespace: 'lumenpulse',
            }),
          ],
          ttl,
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [CacheService],
  exports: [CacheService],
})
export class AppCacheModule {}
