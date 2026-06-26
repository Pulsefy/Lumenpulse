import { Global, Module } from '@nestjs/common';
import { RateLimitStorageService } from './rate-limit.storage';

@Global()
@Module({
  providers: [RateLimitStorageService],
  exports: [RateLimitStorageService],
})
export class RateLimitModule {}
