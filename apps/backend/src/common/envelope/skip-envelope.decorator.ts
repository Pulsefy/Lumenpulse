import { SetMetadata } from '@nestjs/common';
import { SKIP_ENVELOPE_KEY } from './envelope.constants';

/**
 * Exempts a controller or handler from the response envelope, even when the
 * client opts in. Use for non-JSON or externally-specified payloads
 * (Prometheus metrics, health probes consumed by orchestrators).
 */
export const SkipEnvelope = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_ENVELOPE_KEY, true);
