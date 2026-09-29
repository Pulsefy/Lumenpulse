import { Global, Module } from '@nestjs/common';
import { RequestContextService } from './request-context.service';

/**
 * Exposes a single RequestContextService instance app-wide so feature modules
 * (e.g. StellarModule) share the same AsyncLocalStorage as the request-id
 * middleware registered in AppModule.
 */
@Global()
@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class RequestContextModule {}
