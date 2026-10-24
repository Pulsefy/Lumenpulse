/**
 * Request header a client sends to opt in to the standard response envelope.
 *
 * The envelope is opt-in during the transition so existing webapp and mobile
 * clients keep receiving today's response shapes. See
 * `document/API_VERSIONING_STRATEGY.md` for the migration plan.
 */
export const RESPONSE_ENVELOPE_HEADER = 'X-Response-Envelope';

/** The only envelope version currently defined. */
export const RESPONSE_ENVELOPE_VERSION = 'v1';

/** Metadata key set by `@SkipEnvelope()`. */
export const SKIP_ENVELOPE_KEY = 'response-envelope:skip';
