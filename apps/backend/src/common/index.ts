/**
 * Central export point for validation and sanitization utilities.
 * Import from here for convenient access to all security pipes and decorators.
 *
 * Usage:
 * import { Sanitize, sanitizeString } from 'src/common/index';
 */

// Pipes
export { CustomValidationPipe } from './pipes/validation.pipe';
export { SanitizationPipe } from './pipes/sanitization.pipe';

// Decorators
export {
  Sanitize,
  SanitizeTrim,
  EscapeHtml,
  RemoveNullBytes,
  CustomSanitizer,
} from './decorators/sanitize.decorator';

// Utilities
export {
  escapeHtml,
  sanitizeTrim,
  removeNullBytes,
  sanitizeString,
  sanitizeObject,
  sanitizeObjectStringsOnly,
} from './utils/sanitization.util';
