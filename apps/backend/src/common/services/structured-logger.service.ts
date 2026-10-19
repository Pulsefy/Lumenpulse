import { ConsoleLogger, Injectable } from '@nestjs/common';
import { RequestContextService } from './request-context.service';

export interface StructuredLogRecord {
  timestamp: string;
  level: string;
  context?: string;
  correlationId: string;
  requestId: string;
  message: unknown;
  [key: string]: unknown;
}

@Injectable()
export class StructuredLoggerService extends ConsoleLogger {
  constructor(context?: string) {
    super(context || 'App');
  }

  formatStructured(
    level: string,
    message: unknown,
    context?: string,
    ...optionalParams: unknown[]
  ): string {
    const correlationId = RequestContextService.getCorrelationId();
    const timestamp = new Date().toISOString();
    const logContext = context || this.context || 'App';

    // If message is a JSON string, try to parse and augment it
    if (typeof message === 'string') {
      const trimmed = message.trim();
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (
            typeof parsed === 'object' &&
            parsed !== null &&
            !Array.isArray(parsed)
          ) {
            const record = parsed as Record<string, unknown>;
            if (!record.correlationId && correlationId !== 'unknown') {
              record.correlationId = correlationId;
            }
            if (!record.requestId && record.correlationId) {
              record.requestId = record.correlationId;
            }
            if (!record.timestamp) {
              record.timestamp = timestamp;
            }
            if (!record.level) {
              record.level = level;
            }
            if (!record.context && logContext) {
              record.context = logContext;
            }
            return JSON.stringify(record);
          }
        } catch {
          // Fall through to plain string formatting
        }
      }
    }

    // If message is an object
    if (typeof message === 'object' && message !== null) {
      const record = { ...(message as Record<string, unknown>) };
      if (!record.correlationId && correlationId !== 'unknown') {
        record.correlationId = correlationId;
      }
      if (!record.requestId && record.correlationId) {
        record.requestId = record.correlationId;
      }
      if (!record.timestamp) {
        record.timestamp = timestamp;
      }
      if (!record.level) {
        record.level = level;
      }
      if (!record.context && logContext) {
        record.context = logContext;
      }
      return JSON.stringify(record);
    }

    // Merge any extra metadata object if provided in optionalParams
    let extraMeta: Record<string, unknown> = {};
    if (
      optionalParams.length > 0 &&
      typeof optionalParams[0] === 'object' &&
      optionalParams[0] !== null &&
      !Array.isArray(optionalParams[0])
    ) {
      extraMeta = optionalParams[0] as Record<string, unknown>;
    }

    const logRecord: StructuredLogRecord = {
      timestamp,
      level,
      context: logContext,
      correlationId,
      requestId: correlationId,
      message,
      ...extraMeta,
    };

    return JSON.stringify(logRecord);
  }

  override log(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    const formatted = this.formatStructured(
      'log',
      message,
      context,
      ...optionalParams,
    );
    super.log(formatted);
  }

  override error(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    const formatted = this.formatStructured(
      'error',
      message,
      context,
      ...optionalParams,
    );
    super.error(formatted);
  }

  override warn(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    const formatted = this.formatStructured(
      'warn',
      message,
      context,
      ...optionalParams,
    );
    super.warn(formatted);
  }

  override debug(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    const formatted = this.formatStructured(
      'debug',
      message,
      context,
      ...optionalParams,
    );
    super.debug(formatted);
  }

  override verbose(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    const formatted = this.formatStructured(
      'verbose',
      message,
      context,
      ...optionalParams,
    );
    super.verbose(formatted);
  }

  private extractContext(optionalParams: unknown[]): string | undefined {
    if (optionalParams.length > 0) {
      const last = optionalParams[optionalParams.length - 1];
      if (typeof last === 'string') {
        return last;
      }
    }
    return undefined;
  }
}
