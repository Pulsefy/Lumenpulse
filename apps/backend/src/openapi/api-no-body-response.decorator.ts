import { applyDecorators } from '@nestjs/common';
import { ApiExtension, ApiResponse } from '@nestjs/swagger';

/** Operation extension the spec lint reads to allow a bodiless 2xx. */
export const NO_RESPONSE_BODY_EXTENSION = 'x-no-response-body';

/**
 * Documents a success response that intentionally has no body (handler
 * returns void) without changing its status code. Prefer `@HttpCode(204)`
 * for new endpoints.
 */
export const ApiNoBodyResponse = (description: string, status = 200) =>
  applyDecorators(
    ApiResponse({ status, description }),
    ApiExtension(NO_RESPONSE_BODY_EXTENSION, true),
  );
