/**
 * Retries an async function with exponential backoff
 * @param fn - The async function to retry
 * @param maxAttempts - Maximum number of retry attempts
 * @param delay - Initial delay in milliseconds
 * @param shouldRetry - Function to determine if error should be retried
 * @returns The result of the function
 */
/**
 * Retries an async function with exponential backoff
 * Optimized with early returns and bit shift for power of 2
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delay: number = 1000,
  shouldRetry?: (error: unknown) => boolean,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // If shouldRetry is provided and returns false, don't retry
      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === maxAttempts) {
        throw error;
      }

      // Exponential backoff: delay * 2^(attempt - 1)
      // Using bit shift (<<) is faster than Math.pow for powers of 2
      const backoffDelay = delay * (1 << (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }
  }

  // This should never be reached, but TypeScript requires it
  throw new Error('Retry logic failed unexpectedly');
}
