/**
 * Utility functions for consistent log formatting
 */

export interface LogInfo {
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  userAgent?: string;
  ip?: string;
  timestamp: string;
}

/**
 * Formats the HTTP request log entry
 */
export function formatHttpLog(info: LogInfo): string {
  const { method, url, statusCode, durationMs, userAgent, ip, timestamp } =
    info;

  const statusColor = getStatusColor(statusCode);
  const coloredStatus = `\x1b[${statusColor}m${statusCode}\x1b[0m`;

  let logEntry = `[${timestamp}] [HTTP] ${method} ${url} ${coloredStatus} ${durationMs}ms`;

  if (ip) {
    logEntry += ` IP:${ip}`;
  }

  if (userAgent) {
    logEntry += ` UA:"${userAgent}"`;
  }

  return logEntry;
}

/**
 * Returns ANSI color code based on status code
 */
function getStatusColor(statusCode: number): string {
  if (statusCode >= 500) return '31'; // Red
  if (statusCode >= 400) return '33'; // Yellow
  if (statusCode >= 300) return '36'; // Cyan
  if (statusCode >= 200) return '32'; // Green
  return '0'; // Default
}

/**
 * Determines log level based on status code
 */
export function getLogLevel(statusCode: number): 'log' | 'warn' | 'error' {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'log';
}
