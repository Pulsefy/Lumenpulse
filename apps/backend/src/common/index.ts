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

// Access Control exports
export * from './interfaces/access-control.interface';
export * from './services/access-control.service';
export {
  RequirePermission,
  RequireUserRead,
  RequireUserWrite,
  RequirePortfolioRead,
  RequirePortfolioWrite,
  RequireWebhookVerification,
  RequireIpAllowlist,
  RequireApiKey,
  GetAccessContext,
  GetResource,
  GetPermissionResult,
  ResourceTypeDecorator,
  RequireTrustedCaller,
  REQUIRED_PERMISSION_KEY,
  RESOURCE_TYPE_KEY,
  TRUSTED_CALLER_KEY,
  type PermissionMetadata,
  type TrustedCallerMetadata,
} from './decorators/access-control.decorators';
export * from './guards/access-control.guard';
export * from './guards/contract-admin-trusted-caller.guard';
export * from './utils/access-control.utils';

// Feedback & support exports
export * from './interfaces/feedback.interface';
export * from './services/feedbacks.service';
export * from './controllers/feedback.controller';
export * from './modules/feedback.module';
export * from './dto/create-feedback.dto';
export * from './utils/feedback-redaction.util';
