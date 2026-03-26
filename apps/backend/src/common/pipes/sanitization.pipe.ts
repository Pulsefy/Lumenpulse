import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
  Scope,
} from '@nestjs/common';
import { sanitizeObjectStringsOnly } from '../utils/sanitization.util';

/**
 * Sanitization pipe for input sanitization.
 * Sanitizes string values in the request body to prevent XSS attacks.
 *
 * Usage:
 * - Global: `app.useGlobalPipes(new SanitizationPipe());`
 * - In-method: Apply after ValidationPipe to preserve validation first
 * - Per parameter: `@Body(new SanitizationPipe()) dto: CreateDto`
 *
 * Scope: REQUEST - Makes sense to create a new instance per request
 */
@Injectable({ scope: Scope.REQUEST })
export class SanitizationPipe implements PipeTransform {
  /**
   * Transform method - applied to request data.
   * Sanitizes string fields in body, query, and param objects.
   *
   * @param value - The value to sanitize
   * @param metadata - Metadata about the parameter
   * @returns Sanitized value
   */
  transform(value: any, metadata: ArgumentMetadata): any {
    // Only sanitize request body, query params, and path params
    if (
      metadata.type === 'body' ||
      metadata.type === 'query' ||
      metadata.type === 'param'
    ) {
      return sanitizeObjectStringsOnly(value);
    }

    return value;
  }
}
