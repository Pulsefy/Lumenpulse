import { Injectable, OnModuleInit } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  correlationId?: string;
  requestId?: string;
  [key: string]: unknown;
}

/**
 * RequestContextService
 *
 * Provides request-scoped context propagation using AsyncLocalStorage.
 * This allows correlation IDs and other request metadata to be accessed
 * anywhere in the call stack without explicit parameter passing.
 *
 * Usage:
 *   // In middleware/interceptor/queue/outbox:
 *   requestContextService.run({ correlationId: 'abc-123', requestId: 'abc-123' }, () => {
 *     // All code here can access the context
 *   });
 *
 *   // In any service:
 *   const correlationId = requestContextService.getCorrelationId();
 *   // Or statically (useful for custom loggers):
 *   const correlationId = RequestContextService.getCorrelationId();
 */
@Injectable()
export class RequestContextService implements OnModuleInit {
  private static readonly globalStorage =
    new AsyncLocalStorage<RequestContext>();
  private readonly storage = RequestContextService.globalStorage;

  onModuleInit(): void {
    // AsyncLocalStorage is ready to use
  }

  /**
   * Static access to the current correlation ID
   */
  static getCorrelationId(): string {
    const store = RequestContextService.globalStorage.getStore();
    return (
      (typeof store?.correlationId === 'string' && store.correlationId) ||
      (typeof store?.requestId === 'string' && store.requestId) ||
      'unknown'
    );
  }

  /**
   * Static access to the current request ID (alias of correlation ID)
   */
  static getRequestId(): string {
    return RequestContextService.getCorrelationId();
  }

  /**
   * Static access to the current context
   */
  static getContext(): RequestContext | undefined {
    return RequestContextService.globalStorage.getStore();
  }

  /**
   * Static helper to run within context
   */
  static run<T>(context: RequestContext, fn: () => T): T {
    return RequestContextService.globalStorage.run(context, fn);
  }

  /**
   * Run a function with the given request context
   */
  run<T>(context: RequestContext, fn: () => T): T {
    return RequestContextService.run(context, fn);
  }

  /**
   * Get the current request context, or undefined if outside a request
   */
  getContext(): RequestContext | undefined {
    return RequestContextService.getContext();
  }

  /**
   * Get the current correlation ID, or 'unknown' if outside a request
   */
  getCorrelationId(): string {
    return RequestContextService.getCorrelationId();
  }

  /**
   * Get the current request ID, or 'unknown' if outside a request
   */
  getRequestId(): string {
    return RequestContextService.getRequestId();
  }

  /**
   * Set a value in the current request context
   */
  set(key: string, value: unknown): void {
    const store = this.storage.getStore();
    if (store) {
      store[key] = value;
    }
  }

  /**
   * Get a value from the current request context
   */
  get<T = unknown>(key: string): T | undefined {
    const store = this.storage.getStore();
    return store?.[key] as T | undefined;
  }
}
