import { SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

export const DEPRECATED_KEY = 'isDeprecated';
export const DEPRECATION_META_KEY = 'deprecationMeta';

export interface DeprecationOptions {
  /** Version this endpoint was deprecated in e.g. 'v1' */
  since: string;
  /** Version this endpoint will be removed in e.g. 'v3' */
  removeIn?: string;
  /** Replacement endpoint path e.g. '/v2/portfolio' */
  replacement?: string;
  /** Extra human-readable message */
  message?: string;
}

/**
 * Marks a controller or route as deprecated.
 * - Sets Deprecation + Sunset response headers automatically (via DeprecationInterceptor)
 * - Adds a Swagger deprecation notice
 *
 * Usage:
 *   @Deprecated({ since: 'v1', removeIn: 'v3', replacement: '/v2/users' })
 *   @Get()
 *   findAll() { ... }
 */
export function Deprecated(options: DeprecationOptions) {
  return applyDecorators(
    SetMetadata(DEPRECATED_KEY, true),
    SetMetadata(DEPRECATION_META_KEY, options),
    ApiHeader({
      name: 'Deprecation',
      description: `This endpoint was deprecated in ${options.since}.`,
      required: false,
    }),
  );
}