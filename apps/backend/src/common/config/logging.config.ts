/**
 * Configuration for logging system
 */

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
    enabled:
      process.env.LOGGING_ENABLED === 'false'
        ? false
        : defaultLoggingConfig.enabled,
    level:
      (process.env.LOGGING_LEVEL as 'log' | 'warn' | 'error' | undefined) ||
      defaultLoggingConfig.level,
    includeBody:
      process.env.LOGGING_INCLUDE_BODY === 'true'
        ? true
        : defaultLoggingConfig.includeBody,
    includeResponse:
      process.env.LOGGING_INCLUDE_RESPONSE === 'true'
        ? true
        : defaultLoggingConfig.includeResponse,
    includeIP:
      process.env.LOGGING_INCLUDE_IP !== 'false'
        ? true
        : defaultLoggingConfig.includeIP,
    includeUserAgent:
      process.env.LOGGING_INCLUDE_USER_AGENT !== 'false'
        ? true
        : defaultLoggingConfig.includeUserAgent,
    excludeRoutes:
      process.env.LOGGING_EXCLUDE_ROUTES?.split(',') ||
      defaultLoggingConfig.excludeRoutes,
  };
}
