import { Module } from '@nestjs/common';
import { QueryProfilerService } from './query-profiler.service';
import { QueryProfilerInterceptor } from './query-profiler.interceptor';

@Module({
  providers: [QueryProfilerService, QueryProfilerInterceptor],
  exports: [QueryProfilerService, QueryProfilerInterceptor],
})
export class ProfilingModule {}
