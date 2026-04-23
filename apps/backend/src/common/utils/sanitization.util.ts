/**
 * Sanitization utilities for preventing XSS and other injection attacks.
 * Handles trimming, HTML escaping, and basic input sanitization.
 */

/**
 * HTML special characters map for escaping
 */
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
};

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * This is a basic sanitization and should be combined with other security measures.
 *
 * @param str - String to escape
 * @returns Escaped string safe for HTML context
 * @example
 * escapeHtml('<script>alert("xss")</script>')
 * // Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;'
 */
export function escapeHtml(str: string): string {
  if (!str || typeof str !== 'string') {
    return str;
  }
  return str.replace(/[&<>"'/]/g, (char) => HTML_ESCAPE_MAP[char]);
}

/**
 * Trims whitespace from a string.
 * Removes leading and trailing whitespace.
 *
 * @param str - String to trim
 * @returns Trimmed string
 */
export function sanitizeTrim(str: string): string {
  return typeof str === 'string' ? str.trim() : str;
}

/**
 * Removes null bytes which can be used in attacks.
 *
 * @param str - String to clean
 * @returns String without null bytes
 */
export function removeNullBytes(str: string): string {
  if (!str || typeof str !== 'string') {
    return str;
  }
  return str.replace(/\0/g, '');
}

/**
 * Sanitizes a string with multiple sanitization steps.
 * Steps:
 * 1. Remove null bytes
 * 2. Trim whitespace
 * 3. Escape HTML special characters
 *
 * @param str - String to sanitize
 * @returns Sanitized string
 */
export function sanitizeString(str: string): string {
  if (!str || typeof str !== 'string') {
    return str;
  }

  return escapeHtml(sanitizeTrim(removeNullBytes(str)));
}

/**
 * Deep sanitization of an object.
 * Recursively sanitizes all string properties in an object.
 *
 * @param obj - Object to sanitize
 * @param sanitizer - Function to apply to each string (default: sanitizeString)
 * @returns Sanitized object
 * @example
 * sanitizeObject({ username: '  <script>alert("xss")</script>  ' })
 * // Returns: { username: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;' }
 */
export function sanitizeObject(
  obj: unknown,
  sanitizer: (str: string) => string = sanitizeString,
): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizer(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, sanitizer));
  }

  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        sanitized[key] = sanitizeObject(
          (obj as Record<string, unknown>)[key],
          sanitizer,
        );
      }
    }
    return sanitized;
  }

  return obj;
}

/**
 * Sanitizes only string fields, preserving object structure.
 * Does not sanitize null/undefined values or non-string types.
 *
 * @param obj - Object to sanitize
 * @returns Object with string fields sanitized
 */
export function sanitizeObjectStringsOnly(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObjectStringsOnly(item));
  }

  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = (obj as Record<string, unknown>)[key];
        if (typeof value === 'string') {
          sanitized[key] = sanitizeString(value);
        } else if (value === null || value === undefined) {
          sanitized[key] = value;
        } else if (Array.isArray(value) || typeof value === 'object') {
          sanitized[key] = sanitizeObjectStringsOnly(value);
        } else {
          sanitized[key] = value;
        }
      }
    }
    return sanitized;
  }

  return obj;
}
