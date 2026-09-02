# API Client Quick Reference

## 🚀 Quick Start

```typescript
import { apiClient } from '@/lib/api-client';

// GET request (auto-retry)
const response = await apiClient.get('/users');

// POST request (no auto-retry)
const response = await apiClient.post('/users', { name: 'John' });

// With cancellation (recommended in React components)
const controller = new AbortController();
const response = await apiClient.get('/data', { 
  signal: controller.signal 
});
controller.abort(); // Cancel request
```

## 🔄 Retry Behavior

| Method | Auto-Retry | Reason |
|--------|-----------|---------|
| GET | ✅ Yes | Idempotent (safe to repeat) |
| PUT | ✅ Yes | Idempotent (safe to repeat) |
| DELETE | ✅ Yes | Idempotent (safe to repeat) |
| HEAD | ✅ Yes | Idempotent (safe to repeat) |
| OPTIONS | ✅ Yes | Idempotent (safe to repeat) |
| POST | ❌ No | Non-idempotent (could duplicate data) |
| PATCH | ❌ No | Non-idempotent (could cause inconsistency) |

## ⏱️ Retry Timing

- **Max retries**: 3 attempts (4 total requests)
- **Backoff formula**: `delay = min(baseDelay * 2^attempt, maxDelay) + jitter`
- **Example progression**:
  - Attempt 1: Immediate
  - Attempt 2: ~1-1.5 seconds
  - Attempt 3: ~2-2.5 seconds
  - Attempt 4: ~4-4.5 seconds

## ⚙️ Configuration Options

```typescript
interface RequestConfig {
  headers?: Record<string, string>;
  timeout?: number;          // Default: 10000ms (10 seconds)
  signal?: AbortSignal;      // For cancellation
  retry?: boolean | {
    maxRetries?: number;             // Default: 3
    baseDelay?: number;              // Default: 1000ms
    maxDelay?: number;               // Default: 10000ms
    jitter?: number;                 // Default: 500ms
    retryableStatusCodes?: number[]; // Default: [408,429,500,502,503,504]
  };
}
```

## 🎯 Common Use Cases

### 1. Basic Request
```typescript
const response = await apiClient.get('/data');
if (response.success) {
  console.log(response.data);
} else {
  console.error(response.error);
}
```

### 2. With Custom Timeout
```typescript
await apiClient.get('/large-data', { 
  timeout: 30000 // 30 seconds
});
```

### 3. With Cancellation (React Hook)
```typescript
useEffect(() => {
  const controller = new AbortController();
  
  apiClient.get('/data', { signal: controller.signal })
    .then(handleResponse);
  
  return () => controller.abort(); // Cleanup
}, []);
```

### 4. Disable Retry
```typescript
await apiClient.get('/data', { retry: false });
```

### 5. Custom Retry Config
```typescript
await apiClient.get('/data', {
  retry: {
    maxRetries: 5,
    baseDelay: 500,
  }
});
```

### 6. Custom Headers
```typescript
await apiClient.get('/data', {
  headers: {
    'X-Custom-Header': 'value'
  }
});
```

### 7. Auth Token
```typescript
// Set token (adds Bearer header to all requests)
apiClient.setAuthToken('your-jwt-token');

// Clear token
apiClient.setAuthToken(null);
```

## 🚨 Error Handling

### Error Types

```typescript
if (!response.success) {
  switch (response.error?.error) {
    case 'TimeoutError':
      // Request took too long (>10s by default)
      showToast('Request timed out');
      break;
      
    case 'OfflineError':
      // Device is offline (detected before retry)
      showToast('No internet connection');
      break;
      
    case 'NetworkError':
      // Network failure (no response received)
      showToast('Network error');
      break;
      
    default:
      // HTTP error with status code
      if (response.error?.statusCode === 401) {
        navigateToLogin();
      } else if (response.error?.statusCode === 404) {
        showNotFound();
      } else {
        showToast(response.error?.message);
      }
  }
}
```

### Import Error Classes

```typescript
import { 
  TimeoutError, 
  OfflineError, 
  NetworkError 
} from '@/lib/api-client';
```

## 🔢 HTTP Status Codes

### Retried Automatically (5xx + specific 4xx)
- `408` Request Timeout
- `429` Too Many Requests
- `500` Internal Server Error
- `502` Bad Gateway
- `503` Service Unavailable
- `504` Gateway Timeout

### NOT Retried (4xx client errors)
- `400` Bad Request
- `401` Unauthorized
- `403` Forbidden
- `404` Not Found
- `422` Unprocessable Entity
- etc.

## 📱 React Component Pattern

```typescript
function DataScreen() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    
    async function fetchData() {
      setLoading(true);
      setError(null);
      
      const response = await apiClient.get('/data', {
        signal: controller.signal,
      });
      
      if (response.success) {
        setData(response.data);
      } else {
        setError(getErrorMessage(response.error));
      }
      
      setLoading(false);
    }
    
    fetchData();
    
    return () => controller.abort();
  }, []);
  
  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorView message={error} />;
  return <DataView data={data} />;
}

function getErrorMessage(error) {
  switch (error?.error) {
    case 'TimeoutError':
      return 'Request timed out. Please try again.';
    case 'OfflineError':
      return 'No internet connection.';
    case 'NetworkError':
      return 'Network error. Please check your connection.';
    default:
      return error?.message || 'An error occurred';
  }
}
```

## ✅ Best Practices

### DO ✅

1. **Always use AbortSignal in React components**
   ```typescript
   useEffect(() => {
     const controller = new AbortController();
     fetchData(controller.signal);
     return () => controller.abort();
   }, []);
   ```

2. **Handle specific error types**
   ```typescript
   if (error?.error === 'OfflineError') {
     showOfflineMessage();
   }
   ```

3. **Set reasonable timeouts**
   ```typescript
   // Quick operations
   { timeout: 5000 }
   
   // Data-heavy operations
   { timeout: 30000 }
   ```

4. **Trust auto-retry for GET/PUT/DELETE**
   - Don't manually retry these
   - The client handles it automatically

### DON'T ❌

1. **Don't manually retry POST/PATCH**
   - Could duplicate data
   - Redesign as idempotent endpoint instead

2. **Don't ignore cancellation**
   ```typescript
   // BAD
   useEffect(() => {
     fetchData();
   }, []);
   
   // GOOD
   useEffect(() => {
     const controller = new AbortController();
     fetchData(controller.signal);
     return () => controller.abort();
   }, []);
   ```

3. **Don't set extremely long timeouts**
   - Mobile users expect fast responses
   - Use 30s max for most operations

4. **Don't override idempotency checks**
   - The safety gate exists for a reason
   - If POST needs retry, make endpoint idempotent

## 🧪 Testing

```bash
# Run tests
npm test

# Watch mode
npm test:watch

# With coverage
npm test:coverage
```

## 📚 Full Documentation

See `API_CLIENT_RETRY_POLICY.md` for:
- Complete feature documentation
- Architecture decisions
- Advanced usage patterns
- Testing guide

## 🔗 Related Files

- `lib/api-client.ts` - Implementation
- `lib/__tests__/api-client.test.ts` - Tests
- `lib/API_CLIENT_RETRY_POLICY.md` - Full docs
- `jest.config.js` - Test configuration
