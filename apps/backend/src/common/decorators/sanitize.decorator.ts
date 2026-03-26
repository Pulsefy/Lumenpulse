import { Transform } from 'class-transformer';
import {
  sanitizeString,
  sanitizeTrim,
  escapeHtml,
  removeNullBytes,
} from '../utils/sanitization.util';

/**
 * Decorator to automatically sanitize string fields in DTOs.
 * Removes null bytes, trims whitespace, and escapes HTML.
 *
 * Usage:
 * ```typescript
 * export class CreateUserDto {
 *   @Sanitize()
 *   @IsString()
 *   @MinLength(3)
 *   username: string;
 *
 *   @Sanitize()
 *   @IsEmail()
 *   email: string;
 * }
 * ```
 *
 * @returns Decorated property transformer
 */
export function Sanitize(): PropertyDecorator {
  return Transform(({ value }) => sanitizeString(value as string));
}

/**
 * Decorator for trimming strings without HTML escaping.
 * Useful for fields where HTML might be intentional (though not recommended).
 *
 * @returns Decorated property transformer
 */
export function SanitizeTrim(): PropertyDecorator {
  return Transform(({ value }) => sanitizeTrim(value as string));
}

/**
 * Decorator for HTML escaping without trimming.
 * Useful for fields where whitespace might be intentional.
 *
 * @returns Decorated property transformer
 */
export function EscapeHtml(): PropertyDecorator {
  return Transform(({ value }) => escapeHtml(value as string));
}

/**
 * Decorator for removing null bytes only.
 *
 * @returns Decorated property transformer
 */
export function RemoveNullBytes(): PropertyDecorator {
  return Transform(({ value }) => removeNullBytes(value as string));
}

/**
 * Decorator for custom sanitization logic.
 * Allows you to specify a custom sanitizer function.
 *
 * Usage:
 * ```typescript
 * @CustomSanitizer((value) => value.toLowerCase())
 * email: string;
 * ```
 *
 * @param sanitizer - Custom sanitization function
 * @returns Decorated property transformer
 */
export function CustomSanitizer(
  sanitizer: (value: string) => string,
): PropertyDecorator {
  return Transform(({ value }) => {
    if (typeof value === 'string') {
      return sanitizer(value);
    }
    return value as unknown;
  });
}
