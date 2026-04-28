import { Inject, Injectable, Optional } from '@nestjs/common';
import { StructuredLogger, LoggingOptions } from './structured-logger.service';
import { STRUCTURED_LOGGER_OPTIONS, StructuredLoggerModuleOptions } from './structured-logger.module';

export const STRUCTURED_LOGGER = 'STRUCTURED_LOGGER';

/**
 * Factory function to create a structured logger with context
 * Usage: createLogger('UserService')
 */
export function createStructuredLogger(context: string, options?: LoggingOptions): StructuredLogger {
  return new StructuredLogger(context, options);
}

/**
 * Injectable service that provides structured logging capabilities
 * Inject this into your services to use structured logging
 */
@Injectable()
export class LoggerService {
  private readonly logger: StructuredLogger;

  constructor(
    @Optional() @Inject(STRUCTURED_LOGGER_OPTIONS) private readonly options?: StructuredLoggerModuleOptions,
  ) {
    const context = this.options?.context || 'App';
    const loggerOptions = this.options?.options;
    this.logger = new StructuredLogger(context, loggerOptions);
  }

  /**
   * Get a logger for a specific context
   * @param context The context name (usually the service/class name)
   */
  getLogger(context: string): StructuredLogger {
    return new StructuredLogger(context, this.options?.options);
  }

  /**
   * Log info level message
   */
  log(message: string, context?: Record<string, unknown>, metadata?: Record<string, unknown>): void {
    this.logger.logInfo(message, context as any, metadata);
  }

  /**
   * Log warning level message
   */
  warn(message: string, context?: Record<string, unknown>, metadata?: Record<string, unknown>): void {
    this.logger.logWarn(message, context as any, metadata);
  }

  /**
   * Log error level message
   */
  error(message: string, context?: Record<string, unknown>, metadata?: Record<string, unknown>): void {
    this.logger.logError(message, context as any, metadata);
  }

  /**
   * Log debug level message
   */
  debug(message: string, context?: Record<string, unknown>, metadata?: Record<string, unknown>): void {
    this.logger.logDebug(message, context as any, metadata);
  }
}

/**
 * Decorator to inject LoggerService into a class
 * Usage: @InjectLogger() private logger: StructuredLogger;
 */
export function InjectLogger(context?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    // This is a marker decorator - the actual injection is handled by the module
    return descriptor;
  };
}

/**
 * Example usage in a service:
 * 
 * ```typescript
 * import { Injectable, Logger } from '@nestjs/common';
 * import { StructuredLogger } from './common/services/structured-logger.service';
 * 
 * @Injectable()
 * export class UserService {
 *   private readonly logger = new StructuredLogger('UserService');
 * 
 *   async createUser(dto: CreateUserDto): Promise<User> {
 *     this.logger.logInfo('Creating user', { email: dto.email });
 *     
 *     try {
 *       const user = await this.userRepository.create(dto);
 *       this.logger.logInfo('User created successfully', { userId: user.id });
 *       return user;
 *     } catch (error) {
 *       this.logger.logError('Failed to create user', { email: dto.email }, { error: error.message });
 *       throw error;
 *     }
 *   }
 * }
 * ```
 */