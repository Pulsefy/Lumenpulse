import { Injectable, LoggerService, Optional } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export interface LogContext {
  requestId?: string;
  userId?: string;
  correlationId?: string;
  [key: string]: unknown;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | debug';
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
  customFields?: (req: Request, res: Response) => Record<string, unknown>;
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

  private shouldLog(req?: Request): boolean {
    if (!req || !this.options.excludePaths) return true;
    const path = req.url || '';
    return !this.options.excludePaths.some((excluded) => path.startsWith(excluded));
  }

  private buildLogEntry(
    level: StructuredLogEntry['level'],
    message: string,
    context?: LogContext,
    metadata?: Record<string, unknown>,
    req?: Request,
    res?: Response,
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
    // JSON format for machine parsing
    return JSON.stringify(entry);
  }

  private log(entry: StructuredLogEntry): void {
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

  logInfo(message: string, context?: LogContext, metadata?: Record<string, unknown>, req?: Request, res?: Response): void {
    if (!this.shouldLog(req)) return;
    const entry = this.buildLogEntry('info', message, context, metadata, req, res);
    this.log(entry);
  }

  logWarn(message: string, context?: LogContext, metadata?: Record<string, unknown>, req?: Request, res?: Response): void {
    if (!this.shouldLog(req)) return;
    const entry = this.buildLogEntry('warn', message, context, metadata, req, res);
    this.log(entry);
  }

  logError(message: string, context?: LogContext, metadata?: Record<string, unknown>, req?: Request, res?: Response): void {
    if (!this.shouldLog(req)) return;
    const entry = this.buildLogEntry('error', message, context, metadata, req, res);
    this.log(entry);
  }

  logDebug(message: string, context?: LogContext, metadata?: Record<string, unknown>, req?: Request, res?: Response): void {
    if (!this.shouldLog(req)) return;
    const entry = this.buildLogEntry('debug', message, context, metadata, req, res);
    this.log(entry);
  }

  // NestJS LoggerService implementation
  log(message: string, context?: string): void {
    const ctx = context || this.context;
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message,
      context: ctx,
    };
    this.log(entry);
  }

  error(message: string, trace?: string, context?: string): void {
    const ctx = context || this.context;
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message: trace ? `${message}\n${trace}` : message,
      context: ctx,
    };
    this.log(entry);
  }

  warn(message: string, context?: string): void {
    const ctx = context || this.context;
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'warn',
      message,
      context: ctx,
    };
    this.log(entry);
  }

  debug(message: string, context?: string): void {
    const ctx = context || this.context;
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'debug',
      message,
      context: ctx,
    };
    this.log(entry);
  }

  verbose(message: string, context?: string): void {
    this.debug(message, context);
  }
}