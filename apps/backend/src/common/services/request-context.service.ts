import { Injectable, OnModuleInit } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
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
 *   // In middleware/interceptor:
 *   requestContextService.run({ requestId: 'abc-123' }, () => {
 *     // All code here can access the context
 *   });
 *
 *   // In any service:
 *   const requestId = requestContextService.getRequestId();
 */
@Injectable()
export class RequestContextService implements OnModuleInit {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  onModuleInit(): void {
    // AsyncLocalStorage is ready to use
  }

  /**
   * Run a function with the given request context
   */
  run<T>(context: RequestContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  /**
   * Get the current request context, or undefined if outside a request
   */
  getContext(): RequestContext | undefined {
    return this.storage.getStore();
  }

  /**
   * Get the current request ID, or 'unknown' if outside a request
   */
  getRequestId(): string {
    return this.storage.getStore()?.requestId ?? 'unknown';
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
