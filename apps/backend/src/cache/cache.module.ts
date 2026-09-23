import { Module } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createKeyv } from '@keyv/redis';
import { CacheService } from './cache.service';

@Module({
  imports: [
    NestCacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('REDIS_HOST', 'localhost');
        const port = configService.get<number>('REDIS_PORT', 6379);
        const redisUrl = process.env.REDIS_URL ?? `redis://${host}:${port}`;
        const ttl = configService.get<number>('CACHE_TTL_MS', 300_000);
        return {
          stores: [
            createKeyv(redisUrl, {
              namespace: 'lumenpulse',
              // Invalidation must not be reported as successful when Redis
              // silently converts a failed operation into false/undefined.
              throwOnErrors: true,
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
