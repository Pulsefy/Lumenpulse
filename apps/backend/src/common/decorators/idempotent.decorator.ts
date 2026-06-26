import { SetMetadata } from '@nestjs/common';

export const IS_IDEMPOTENT_KEY = 'isIdempotent';
export const IDEMPOTENT_OPTIONS_KEY = 'idempotentOptions';

export interface IdempotentOptions {
  /**
   * TTL for the idempotency key in the cache (in milliseconds).
   * Default is 24 hours.
   */
  ttl?: number;
  /**
   * Header name to look for the idempotency key.
   * Default is 'Idempotency-Key'.
   */
  header?: string;
  /**
   * Methods to apply idempotency to.
   * Default is ['POST', 'PUT', 'DELETE', 'PATCH'].
   */
  methods?: string[];
}

/**
 * Decorator to enable idempotency on a specific route or controller.
 * When applied to a controller, all mutation methods will be idempotent.
 */
export const Idempotent = (options: IdempotentOptions = {}) =>
  SetMetadata(IDEMPOTENT_OPTIONS_KEY, options);
