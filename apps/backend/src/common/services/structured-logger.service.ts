import { Injectable, LoggerService } from '@nestjs/common';
// import { Request, Response } from 'express';
// import type { StructuredLoggerModuleOptions } from './structured-logger.module';
// import { STRUCTURED_LOGGER_OPTIONS } from './structured-logger.module';

export interface LogContext {
  requestId?: string;
  userId?: string;
  correlationId?: string;
  [key: string]: unknown;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  context: string;
  requestId?: string;
  userId?: string;
  correlationId?: string;
  method?: string;
  url?: string;
  statusCode?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface LoggingOptions {
  includeRequestDetails?: boolean;
  includeHeaders?: boolean;
  excludePaths?: string[];
  customFields?: (req: any, res: any) => Record<string, unknown>;
}

@Injectable()
export class StructuredLogger implements LoggerService {
  private context: string;
  private options: LoggingOptions;

  constructor(context: string = 'App', options: LoggingOptions = {}) {
    this.context = context;
    this.options = {
      includeRequestDetails: true,
      includeHeaders: false,
      excludePaths: ['/health', '/metrics'],
      ...options,
    };
  }

  setContext(context: string): void {
    this.context = context;
  }

  setOptions(options: Partial<LoggingOptions>): void {
    this.options = { ...this.options, ...options };
  }

  private shouldLog(req?: any): boolean {
    if (!req || !this.options.excludePaths) return true;
    const path = req.url || '';
    return !this.options.excludePaths.some((excluded) =>
      path.startsWith(excluded),
    );
  }

  private buildLogEntry(
    level: StructuredLogEntry['level'],
    message: string,
    context?: LogContext,
    metadata?: Record<string, unknown>,
    req?: any,
    res?: any,
  ): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: this.context,
      ...context,
    };

    if (this.options.includeRequestDetails && req && res) {
      entry.method = req.method;
      entry.url = req.url;
      entry.statusCode = res.statusCode;
    }

    if (metadata) {
      entry.metadata = metadata;
    }

    return entry;
  }

  private formatLogEntry(entry: StructuredLogEntry): string {
    return JSON.stringify(entry);
  }

  private write(entry: StructuredLogEntry): void {
    const formatted = this.formatLogEntry(entry);

    switch (entry.level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'debug':
        console.debug(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  log(message: any, context?: string): any {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'info',
      message,
      context: context || this.context,
    });
  }

  error(message: any, trace?: string, context?: string): any {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'error',
      message: trace ? `${message}\n${trace}` : message,
      context: context || this.context,
    });
  }

  warn(message: any, context?: string): any {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message,
      context: context || this.context,
    });
  }

  debug(message: any, context?: string): any {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'debug',
      message,
      context: context || this.context,
    });
  }

  verbose(message: any, context?: string): any {
    this.debug(message, context);
  }

  logInfo(message: string, context?: LogContext, metadata?: Record<string, unknown>, req?: any, res?: any): void {
    if (!this.shouldLog(req)) return;

    const entry = this.buildLogEntry('info', message, context, metadata, req, res);
    this.write(entry);
  }

  logWarn(message: string, context?: LogContext, metadata?: Record<string, unknown>, req?: any, res?: any): void {
    if (!this.shouldLog(req)) return;

    const entry = this.buildLogEntry('warn', message, context, metadata, req, res);
    this.write(entry);
  }

  logError(message: string, context?: LogContext, metadata?: Record<string, unknown>, req?: any, res?: any): void {
    if (!this.shouldLog(req)) return;

    const entry = this.buildLogEntry('error', message, context, metadata, req, res);
    this.write(entry);
  }

  logDebug(message: string, context?: LogContext, metadata?: Record<string, unknown>, req?: any, res?: any): void {
    if (!this.shouldLog(req)) return;

    const entry = this.buildLogEntry('debug', message, context, metadata, req, res);
    this.write(entry);
  }
}