import { ApiError } from './api-client';

/**
 * Map ApiError to user-friendly message strings.
 * Keep messages short and actionable for mobile UI.
 */
export function getFriendlyError(error?: ApiError | null): string {
  if (!error) return 'Something went wrong. Please try again.';

  const code = error.statusCode;
  const err = (error.error || '').toString();

  // Network / timeout
  if (err === 'TimeoutError' || error.message?.toLowerCase().includes('timeout')) {
    return 'Request timed out. Check your connection and try again.';
  }

  if (err === 'AbortError') {
    return 'Request cancelled.';
  }

  // Specific HTTP status codes
  if (code === 401) return 'You are not authorized. Please sign in again.';
  if (code === 403) return "You don't have permission to perform this action.";
  if (code === 404) return 'Requested resource not found.';
  if (code === 429) return 'Too many requests. Please wait a moment and try again.';
  if (code && code >= 500) return 'Server is having issues. Please try again later.';

  // Fallback to server-provided message if helpful
  if (error.message) return error.message;

  return 'An unexpected error occurred. Please try again.';
}

export default getFriendlyError;
