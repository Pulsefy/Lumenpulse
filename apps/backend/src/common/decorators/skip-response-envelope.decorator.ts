import { SetMetadata } from '@nestjs/common';
import { SKIP_RESPONSE_ENVELOPE_KEY } from '../dto/api-response.dto';

/**
 * Apply to a controller class or handler method to opt out of the global
 * response envelope. Use for health checks, metrics, streaming, and any
 * endpoint that intentionally returns a non-standard body.
 */
export const SkipResponseEnvelope = () =>
  SetMetadata(SKIP_RESPONSE_ENVELOPE_KEY, true);
