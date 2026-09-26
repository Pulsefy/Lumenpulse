import { Global, Module } from '@nestjs/common';
import { BotPrincipalService } from '../../bot-auth/bot-principal.service';
import { RateLimitPrincipalResolver } from './rate-limit.principal';
import { RateLimitStorageService } from './rate-limit.storage';

@Global()
@Module({
  providers: [
    RateLimitStorageService,
    BotPrincipalService,
    RateLimitPrincipalResolver,
  ],
  exports: [RateLimitStorageService, RateLimitPrincipalResolver],
})
export class RateLimitModule {}
