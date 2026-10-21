import { Global, Module } from '@nestjs/common';
import { TracerService } from './tracer.service';
import { TracingMiddleware } from './tracing.middleware';

@Global()
@Module({
  providers: [TracerService, TracingMiddleware],
  exports: [TracerService, TracingMiddleware],
})
export class TracingModule {}
