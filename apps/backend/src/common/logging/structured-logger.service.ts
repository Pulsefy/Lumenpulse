import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';
import { CorrelationService } from '../correlation/correlation.service';

@Injectable()
export class StructuredLogger extends ConsoleLogger {
  constructor(
    context: string,
    private readonly correlationService: CorrelationService,
  ) {
    super(context);
  }

  log(message: unknown, context?: string) {
    this.printMessage('log', message, context);
  }

  error(message: unknown, stack?: string, context?: string) {
    this.printMessage('error', message, context, stack);
  }

  warn(message: unknown, context?: string) {
    this.printMessage('warn', message, context);
  }

  debug(message: unknown, context?: string) {
    this.printMessage('debug', message, context);
  }

  verbose(message: unknown, context?: string) {
    this.printMessage('verbose', message, context);
  }

  private printMessage(
    level: LogLevel,
    message: unknown,
    context?: string,
    stack?: string,
  ) {
    const correlationId = this.correlationService.getCorrelationId();
    const timestamp = new Date().toISOString();

    const logObject: Record<string, unknown> = {
      timestamp,
      level,
      context: context || this.context,
      correlationId,
      message: message,
      ...(stack ? { stack } : {}),
      ...(typeof message === 'object' && message !== null
        ? (message as Record<string, unknown>)
        : {}),
    };

    // In production, we output JSON. In development, we can stick to pretty print or JSON.
    // For this issue, we want "Structured Operational Logging", so JSON is preferred.
    console.log(JSON.stringify(logObject));
  }
}
