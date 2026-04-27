import { Injectable, Logger } from '@nestjs/common';

export interface ProfileOptions {
  thresholdMs?: number;
  label?: string;
}

@Injectable()
export class QueryProfilerService {
  private readonly logger = new Logger(QueryProfilerService.name);

  async profile<T>(
    fn: () => Promise<T>,
    options: ProfileOptions = {},
  ): Promise<T> {
    const { thresholdMs = 100, label = 'Query' } = options;
    const start = performance.now();

    try {
      const result = await fn();
      const duration = performance.now() - start;

      if (duration > thresholdMs) {
        this.logger.warn(
          `[SLOW QUERY] ${label} took ${duration.toFixed(2)}ms (threshold: ${thresholdMs}ms)`,
        );
      } else {
        this.logger.debug(`[QUERY] ${label} took ${duration.toFixed(2)}ms`);
      }

      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.logger.error(
        `[QUERY FAILED] ${label} failed after ${duration.toFixed(2)}ms`,
        error,
      );
      throw error;
    }
  }
}
