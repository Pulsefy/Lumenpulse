import { Global, Module, Provider } from '@nestjs/common';
import { StructuredLogger, LoggingOptions } from './structured-logger.service';

export const STRUCTURED_LOGGER_OPTIONS = 'STRUCTURED_LOGGER_OPTIONS';

export interface StructuredLoggerModuleOptions {
  context?: string;
  options?: LoggingOptions;
}

export interface StructuredLoggerModuleAsyncOptions {
  useFactory: (
    ...args: unknown[]
  ) => StructuredLoggerModuleOptions | Promise<StructuredLoggerModuleOptions>;
  inject?: string[];
}

@Global()
@Module({
  providers: [
    StructuredLogger,
    {
      provide: STRUCTURED_LOGGER_OPTIONS,
      useValue: {},
    },
  ],
  exports: [StructuredLogger, STRUCTURED_LOGGER_OPTIONS],
})
export class StructuredLoggerModule {
  static forRoot(options: StructuredLoggerModuleOptions = {}): Provider {
    return {
      provide: STRUCTURED_LOGGER_OPTIONS,
      useValue: options,
    };
  }

  static forRootAsync(
    options: StructuredLoggerModuleAsyncOptions,
  ): Provider {
    return {
      provide: STRUCTURED_LOGGER_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject || [],
    };
  }
}