/**
 * Configuration for logging system
 */
import { config } from '../../lib/config';

export interface LoggingConfig {
  /**
   * Whether to enable request logging
   * @default true
   */
  enabled: boolean;

  /**
   * Log level threshold
   * @default 'log' - logs everything
   */
  level?: 'log' | 'warn' | 'error';

  /**
   * Whether to include request body in logs
   * @default false
   */
  includeBody?: boolean;

  /**
   * Whether to include response body in logs
   * @default false
   */
  includeResponse?: boolean;

  /**
   * Whether to include IP addresses in logs
   * @default true
   */
  includeIP?: boolean;

  /**
   * Whether to include user agent in logs
   * @default true
   */
  includeUserAgent?: boolean;

  /**
   * Routes to exclude from logging
   * @default []
   */
  excludeRoutes?: string[];
}

/**
 * Default logging configuration
 */
export const defaultLoggingConfig: LoggingConfig = {
  enabled: true,
  level: 'log',
  includeBody: false,
  includeResponse: false,
  includeIP: true,
  includeUserAgent: true,
  excludeRoutes: ['/health', '/metrics'],
};

/**
 * Gets logging configuration from environment or defaults
 */
export function getLoggingConfig(): LoggingConfig {
  return {
    enabled: config.logging.enabled ?? defaultLoggingConfig.enabled,
    level: config.logging.level ?? defaultLoggingConfig.level,
    includeBody: config.logging.includeBody ?? defaultLoggingConfig.includeBody,
    includeResponse:
      config.logging.includeResponse ?? defaultLoggingConfig.includeResponse,
    includeIP: config.logging.includeIP ?? defaultLoggingConfig.includeIP,
    includeUserAgent:
      config.logging.includeUserAgent ?? defaultLoggingConfig.includeUserAgent,
    excludeRoutes: config.logging.excludeRoutes
      ? [...config.logging.excludeRoutes]
      : defaultLoggingConfig.excludeRoutes,
  };
}
