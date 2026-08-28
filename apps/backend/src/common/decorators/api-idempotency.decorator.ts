import { applyDecorators } from '@nestjs/common';
import { ApiHeader, ApiResponse } from '@nestjs/swagger';

/**
 * Documents the optional `Idempotency-Key` header handled globally by
 * IdempotencyInterceptor (see common/interceptors/idempotency.interceptor.ts)
 * for every POST/PUT/PATCH/DELETE request. Apply to mutating endpoints.
 */
export const ApiIdempotencyHeader = () =>
  applyDecorators(
    ApiHeader({
      name: 'Idempotency-Key',
      description:
        'Optional client-generated key that deduplicates retried requests. Replaying the same key with an identical request body returns the original cached response instead of repeating the operation.',
      required: false,
    }),
    ApiResponse({
      status: 409,
      description:
        'A request with the same Idempotency-Key is already being processed.',
    }),
    ApiResponse({
      status: 422,
      description:
        'The Idempotency-Key was already used with a different request body.',
    }),
  );
