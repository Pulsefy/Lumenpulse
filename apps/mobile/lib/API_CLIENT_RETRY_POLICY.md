# API Client Retry Policy

## Overview

The API client implements a robust retry policy with exponential backoff, jitter, timeouts, and cancellation support, designed specifically for mobile environments with flaky networks.

## Features

### 1. **Exponential Backoff with Jitter**

The retry mechanism uses exponential backoff to progressively increase the delay between retry attempts, with random jitter to prevent thundering herd problems.

**Formula:**
```
delay = min(baseDelay * (2 ^ attempt), maxDelay) + random(0, jitter)
```

**Default Configuration:**
- Base delay: 1000ms (1 second)
- Max delay: 10000ms (10 seconds)
- Jitter: 0-500ms
- Max retries: 3

**Example progression:**
- Attempt 1 → Immediate
- Attempt 2 → ~1000-1500ms delay
- Attempt 3 → ~2000-2500ms delay
- Attempt 4 → ~4000-4500ms delay

### 2. **Idempotency-Based Retry Gate**

Only HTTP methods that are **idempotent** (safe to repeat) are automatically retried:
- ✅ `GET` - Retried by default
- ✅ `PUT` - Retried by default
- ✅ `DELETE` - Retried by default
- ✅ `HEAD` - Retried by default
- ✅ `OPTIONS` - Retried by default
- ❌ `POST` - NOT retried (unless explicitly overridden)
- ❌ `PATCH` - NOT retried (unless explicitly overridden)

This prevents data duplication or inconsistent state from retrying non-idempotent operations.

### 3. **Timeout Handling**

Every request has a strict timeout boundary:
- **Default timeout:** 10 seconds (mobile-optimized, stricter than backend's 30s)
- **Custom timeout:** Configurable per request
- **Timeout error:** Throws distinct `TimeoutError` for UI-specific handling

```typescript
// Use default 10s timeout
await apiClient.get('/data');

// Use custom timeout
await apiClient.get('/large-data', { timeout: 15000 });
```

### 4. **Cancellation Support (AbortSignal)**

All requests support `AbortSignal` for proper cleanup on component unmount:

```typescript
import { useEffect } from 'react';

function MyComponent() {
  useEffect(() => {
    const controller = new AbortController();
    
    apiClient.get('/data', { signal: controller.signal })
      .then(response => {
        // Handle response
      });
    
    // Cleanup on unmount
    return () => controller.abort();
  }, []);
}
```

**Benefits:**
- Prevents memory leaks
- Stops ongoing requests when user navigates away
- Halts retry loops immediately

### 5. **Offline Detection**

Integrates with `@react-native-community/netinfo` to detect device connectivity:

- **First request attempt:** Always tried, regardless of connectivity state
- **Before retries:** Checks network state
- **If offline:** Immediately throws `OfflineError` without wasting retry attempts
- **No spinning:** Prevents battery drain and resource waste

```typescript
// Device goes offline during retry loop
// → Stops immediately with OfflineError
// → No further retries attempted
```

### 6. **Retryable vs Non-Retryable Errors**

**Retryable (will retry automatically):**
- HTTP 408 (Request Timeout)
- HTTP 429 (Too Many Requests)
- HTTP 500 (Internal Server Error)
- HTTP 502 (Bad Gateway)
- HTTP 503 (Service Unavailable)
- HTTP 504 (Gateway Timeout)
- Network failures (no response received)
- Timeout errors

**Non-Retryable (fail immediately):**
- HTTP 4xx client errors (400, 401, 403, 404, etc.)
  - These indicate client-side issues that won't be fixed by retrying
- `OfflineError` - Device is offline
- Request cancellation - User explicitly cancelled

## Usage Examples

### Basic Usage

```typescript
// GET request with automatic retry
const response = await apiClient.get('/users');

if (response.success) {
  console.log(response.data);
} else {
  // Handle specific error types
  if (response.error?.error === 'TimeoutError') {
    // Show timeout message
  } else if (response.error?.error === 'OfflineError') {
    // Show offline message
  } else {
    // Show generic error
  }
}
```

### Custom Retry Configuration

```typescript
// Customize retry behavior
await apiClient.get('/data', {
  retry: {
    maxRetries: 5,           // More retries
    baseDelay: 500,          // Faster initial retry
    maxDelay: 15000,         // Longer max delay
    jitter: 1000,            // More jitter
    retryableStatusCodes: [404, 503], // Custom retryable codes
  },
});
```

### Disable Retries

```typescript
// Disable retries for a specific request
await apiClient.get('/data', { retry: false });
```

### POST with Explicit Retry (Not Recommended)

```typescript
// Force retry for POST (use with caution!)
// Only do this if your POST endpoint is idempotent
await apiClient.post('/idempotent-action', data, {
  retry: { maxRetries: 2 },
});
// Note: This still won't retry because POST is non-idempotent
// The idempotency gate prevents this for safety
```

### With Cancellation

```typescript
const controller = new AbortController();

// Start request
const promise = apiClient.get('/data', {
  signal: controller.signal,
  timeout: 30000,
});

// Cancel after 5 seconds if not done
setTimeout(() => controller.abort(), 5000);

try {
  const response = await promise;
  // Handle response
} catch (error) {
  // Request was cancelled
}
```

## Error Handling

### Error Types

The API client provides distinct error classes for different failure scenarios:

```typescript
import { TimeoutError, OfflineError, NetworkError } from '@/lib/api-client';

try {
  const response = await apiClient.get('/data');
  
  if (!response.success) {
    switch (response.error?.error) {
      case 'TimeoutError':
        // Request took too long
        showToast('Request timed out. Please try again.');
        break;
        
      case 'OfflineError':
        // Device is offline
        showToast('You are offline. Please check your connection.');
        break;
        
      case 'NetworkError':
        // Network failure (no response)
        showToast('Network error. Please try again.');
        break;
        
      default:
        // Server error with status code
        if (response.error?.statusCode === 401) {
          // Unauthorized
          navigateToLogin();
        } else {
          // Generic error
          showToast(response.error?.message || 'An error occurred');
        }
    }
  }
} catch (error) {
  // Unexpected error
  console.error('Unexpected error:', error);
}
```

### UI Integration Patterns

**Show appropriate loading states:**

```typescript
function DataScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    const controller = new AbortController();
    
    async function fetchData() {
      setLoading(true);
      setError(null);
      
      const response = await apiClient.get('/data', {
        signal: controller.signal,
      });
      
      setLoading(false);
      
      if (!response.success) {
        // Map error types to user-friendly messages
        if (response.error?.error === 'TimeoutError') {
          setError('The request is taking too long. Please try again.');
        } else if (response.error?.error === 'OfflineError') {
          setError('No internet connection. Please check your network.');
        } else {
          setError(response.error?.message || 'Failed to load data');
        }
        return;
      }
      
      // Handle success
    }
    
    fetchData();
    
    return () => controller.abort();
  }, []);
  
  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorView message={error} onRetry={refetch} />;
  
  return <DataView />;
}
```

## Testing

The API client includes comprehensive tests covering all retry scenarios:

### Run Tests

```bash
# Install jest dependencies first (if not already done)
npm install --save-dev jest jest-expo @types/jest

# Run tests
npm test -- api-client.test.ts

# Run with coverage
npm test -- api-client.test.ts --coverage

# Watch mode
npm test -- api-client.test.ts --watch
```

### Test Coverage

The test suite verifies:
- ✅ Retry behavior for idempotent methods (GET, PUT, DELETE)
- ✅ No retry for non-idempotent methods (POST, PATCH)
- ✅ Exponential backoff with jitter
- ✅ Timeout handling
- ✅ Cancellation support (AbortSignal)
- ✅ Offline detection and immediate failure
- ✅ Custom retry configuration
- ✅ Error normalization
- ✅ Auth token handling
- ✅ Non-retryable 4xx errors

## Configuration

### Global Configuration

The API client uses centralized configuration from `lib/config.ts`:

```typescript
export const config = {
  api: {
    baseUrl: 'https://api.example.com',
    timeout: 30000, // Not used by mobile client (uses 10s default)
  },
};
```

### Per-Request Configuration

Every request accepts a `RequestConfig` object:

```typescript
interface RequestConfig {
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
  retry?: boolean | RetryConfig;
}
```

## Best Practices

### DO ✅

1. **Use AbortSignal for all requests in React components**
   ```typescript
   useEffect(() => {
     const controller = new AbortController();
     fetchData(controller.signal);
     return () => controller.abort();
   }, []);
   ```

2. **Handle specific error types in your UI**
   - Show different messages for timeout vs offline vs server errors
   - Provide retry buttons for transient failures

3. **Trust the retry logic for idempotent operations**
   - Don't manually retry GET/PUT/DELETE requests
   - The client handles this automatically

4. **Set appropriate timeouts**
   - Use shorter timeouts for quick operations
   - Use longer timeouts for data-heavy operations

### DON'T ❌

1. **Don't manually retry POST/PATCH requests**
   - These are non-idempotent by design
   - Retrying could cause data duplication

2. **Don't ignore AbortSignal**
   - Always cleanup requests on unmount
   - Prevents memory leaks and wasted resources

3. **Don't override idempotency checks**
   - The gate exists for data safety
   - If you need retry for POST, redesign the endpoint to be idempotent (use PUT with unique ID)

4. **Don't set extremely long timeouts**
   - Mobile users expect fast responses
   - Long timeouts worsen the user experience

## Architecture Decisions

### Why 10 seconds default timeout?

Mobile users have shorter attention spans and expect faster responses. A 10-second timeout provides:
- Quick feedback on network issues
- Better perceived performance
- Faster error recovery

### Why exponential backoff with jitter?

- **Exponential backoff:** Gives servers time to recover without overwhelming them
- **Jitter:** Prevents synchronized retry storms when many clients fail simultaneously
- **Mobile-specific:** Balances quick recovery with battery efficiency

### Why check connectivity before retry?

Attempting requests when offline wastes:
- Battery power
- Network resources
- User time

Checking connectivity first provides:
- Immediate feedback to user
- Resource conservation
- Better error messages

## Maintenance

When modifying the retry policy:

1. **Update tests first** - Ensure new behavior is covered
2. **Verify idempotency** - Don't break the safety gate
3. **Test with slow networks** - Use Chrome DevTools or Charles Proxy
4. **Test offline scenarios** - Toggle airplane mode
5. **Monitor production** - Track retry rates and error types

## Related Files

- `lib/api-client.ts` - Main implementation
- `lib/__tests__/api-client.test.ts` - Comprehensive test suite
- `lib/config.ts` - Configuration
- `jest.config.js` - Jest configuration
- `jest.setup.js` - Test environment setup
