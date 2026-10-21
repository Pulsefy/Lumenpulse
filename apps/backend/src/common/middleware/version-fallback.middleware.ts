import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Excluded path prefixes that should NOT be rewritten to `/v1`.
 * These include API documentation, root probes, health, and Prometheus metrics.
 */
const EXCLUDED_PREFIXES = [
  '/api/docs',
  '/metrics',
  '/health',
  '/favicon.ico',
  '/robots.txt',
];

/**
 * Matches versioned URLs starting with /v followed by digits (e.g. /v1, /v2, /v1/...).
 */
const VERSIONED_PATH_REGEX = /^\/v\d+(\/.*)?$/;

/**
 * Transition sunset date for unversioned route deprecation (RFC 8594).
 * Provides a 6-month grace period for API consumers to migrate to explicit /v1 prefixes.
 */
export const API_TRANSITION_SUNSET_DATE = 'Mon, 19 Apr 2027 00:00:00 GMT';

/**
 * Middleware that transparently rewrites unversioned incoming requests to `/v1`.
 *
 * During the documented transition period, requests to `/projects`, `/news`,
 * `/users`, etc. resolve to their `/v1/...` counterparts while sending standard
 * deprecation headers (`Deprecation: true`, `Sunset: <date>`, and `Link`).
 */
@Injectable()
export class VersionFallbackMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const originalUrl = req.url;
    const pathOnly = (req.path || originalUrl).split('?')[0];

    // Check if the route is root '/'
    if (pathOnly === '/' || pathOnly === '') {
      return next();
    }

    // Check if path is already versioned (/v1, /v2, etc.)
    if (VERSIONED_PATH_REGEX.test(pathOnly)) {
      return next();
    }

    // Check if path matches any excluded system prefix
    const isExcluded = EXCLUDED_PREFIXES.some(
      (prefix) => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`),
    );

    if (isExcluded) {
      return next();
    }

    // Rewrite request URL to point to /v1
    const separator = originalUrl.startsWith('/') ? '' : '/';
    req.url = `/v1${separator}${originalUrl}`;

    // Emit deprecation and successor link headers (RFC 8594 / RFC 8288)
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', API_TRANSITION_SUNSET_DATE);
    const targetPath = `/v1${pathOnly.startsWith('/') ? '' : '/'}${pathOnly}`;
    res.setHeader('Link', `<${targetPath}>; rel="successor-version"`);

    next();
  }
}
