import { SetMetadata } from '@nestjs/common';
import { RATE_LIMIT_ENDPOINT_CLASS_KEY } from './rate-limit.constants';
import type { RateLimitEndpointClass as EndpointClass } from './rate-limit.constants';

/**
 * Tags a controller or handler with its rate-limit endpoint class.
 *
 * The class is used by {@link RateLimitGuard} to:
 *   - label rejection metrics (`rate_limit_rejections_total{endpoint_class}`),
 *   - share one bucket across all routes of an expensive class, and
 *   - select bot / service specific profiles.
 *
 * This decorator is metadata-only. Prefer `RateLimitPolicy()` from
 * `rate-limit.config`, which also applies the matching `@Throttle` profile.
 */
export const RateLimitEndpointClass = (endpointClass: EndpointClass) =>
  SetMetadata(RATE_LIMIT_ENDPOINT_CLASS_KEY, endpointClass);
