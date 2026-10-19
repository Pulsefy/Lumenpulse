import { Module } from '@nestjs/common';
import {
  RATE_LIMIT_KEYV_STORE,
  RateLimitStorageService,
} from '../src/common/rate-limit/rate-limit.storage';
import { Keyv } from 'keyv';

@Module({
  providers: [
    { provide: RATE_LIMIT_KEYV_STORE, useValue: new Keyv() },
    RateLimitStorageService,
  ],
  exports: [RateLimitStorageService],
})
export class InMemoryRateLimitStorageModule {}
