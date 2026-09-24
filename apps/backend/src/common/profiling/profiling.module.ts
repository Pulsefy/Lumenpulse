import { Module } from '@nestjs/common';
import { QueryProfilerService } from './query-profiler.service';
import { QueryProfilerInterceptor } from './query-profiler.interceptor';
import { QueryCountMiddleware } from './query-count.middleware';

/**
 * ProfilingModule
 *
 * Provides timing and call-count profiling helpers.  All exports are
 * safe to use in production – the call-count path is a no-op unless
 * the QUERY_PROFILING environment variable is set to "true".
 */
@Module({
  providers: [QueryProfilerService, QueryProfilerInterceptor, QueryCountMiddleware],
  exports: [QueryProfilerService, QueryProfilerInterceptor, QueryCountMiddleware],
})
export class ProfilingModule {}
