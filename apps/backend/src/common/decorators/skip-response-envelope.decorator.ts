import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_ENVELOPE_KEY = 'skipResponseEnvelope';

/**
 * Decorator to skip response envelope wrapping for specific endpoints.
 *
 * Use this decorator on endpoints that need to return raw responses
 * (e.g., webhooks, file downloads, streaming responses, or legacy endpoints).
 *
 * @example
 * @SkipResponseEnvelope()
 * @Get('webhook')
 * handleWebhook() {
 *   return { raw: 'response' };
 * }
 */
export const SkipResponseEnvelope = () =>
  SetMetadata(SKIP_RESPONSE_ENVELOPE_KEY, true);
