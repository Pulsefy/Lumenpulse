# API Client Documentation

## Overview

The API client provides a centralized, typed interface for communicating with the NestJS backend. All configuration comes from environment variables, and errors are normalized into a consistent shape.

## Files

- `api-client.ts` - Core HTTP client with typed methods (GET, POST, PUT, PATCH, DELETE)
- `api.ts` - Domain-specific API services (auth, health, etc.)
- `config.ts` - Centralized environment configuration

## Configuration

### Environment Variables

Create a `.env` file in the mobile app root (copy from `.env.example`):

```env
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_APP_VARIANT=development
```

**Important:** Use the `EXPO_PUBLIC_` prefix to make variables available in the app.

### Fallback Priority

1. `process.env.EXPO_PUBLIC_API_URL`
2. `Constants.expoConfig.extra.backendUrl` (from app.json)
3. Default: `http://localhost:3000`

## Usage

### Basic HTTP Requests

```typescript
import { apiClient } from '@/lib/api-client';

// GET request
const response = await apiClient.get<User>('/users/me');
if (response.success) {
  console.log('User:', response.data);
} else {
  console.error('Error:', response.error?.message);
}

// POST request
const response = await apiClient.post<CreateResponse>('/items', {
  name: 'New Item',
  description: 'Item description',
});

// PUT request
const response = await apiClient.put<UpdateResponse>('/items/123', {
  name: 'Updated Item',
});

// DELETE request
const response = await apiClient.delete('/items/123');
```

### Using Domain Services

```typescript
import { authApi, healthApi } from '@/lib/api';

// Login
const loginResponse = await authApi.login({
  email: 'user@example.com',
  password: 'password123',
});

if (loginResponse.success) {
  const { access_token } = loginResponse.data;
  // Store token and set for future requests
  apiClient.setAuthToken(access_token);
}

// Health check
const healthResponse = await healthApi.check();
console.log('Backend status:', healthResponse.data?.status);
```

### Error Handling

All responses follow the `ApiResponse<T>` shape:

```typescript
interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
  success: boolean;
}

interface ApiError {
  message: string;
  statusCode?: number;
  error?: string;
  details?: unknown;
}
```

Example error handling:

```typescript
const response = await apiClient.get('/some-endpoint');

if (!response.success) {
  const error = response.error;
  
  // Display user-friendly message
  Alert.alert('Error', error?.message || 'Something went wrong');
  
  // Log for debugging
  console.error('API Error:', {
    message: error?.message,
    statusCode: error?.statusCode,
    details: error?.details,
  });
  
  return;
}

// Success - use response.data
const data = response.data;
```

### Authentication

Set the auth token after login:

```typescript
import { apiClient } from '@/lib/api-client';

// After successful login
apiClient.setAuthToken(accessToken);

// Clear token on logout
apiClient.setAuthToken(null);
```

The token is automatically included in all subsequent requests as:
```
Authorization: Bearer <token>
```

### Request Configuration

Customize individual requests:

```typescript
// Custom headers
const response = await apiClient.get('/endpoint', {
  headers: {
    'X-Custom-Header': 'value',
  },
});

// Custom timeout (default: 30s)
const response = await apiClient.post('/endpoint', data, {
  timeout: 60000, // 60 seconds
});

// Abort signal for cancellation
const controller = new AbortController();
const response = await apiClient.get('/endpoint', {
  signal: controller.signal,
});

// Cancel the request
controller.abort();
```

## Creating New API Services

Add new domain services to `api.ts`:

```typescript
// Define types
export interface NewsArticle {
  id: string;
  title: string;
  content: string;
}

// Create service
export const newsApi = {
  async getArticles(): Promise<ApiResponse<NewsArticle[]>> {
    return apiClient.get<NewsArticle[]>('/news');
  },

  async getArticle(id: string): Promise<ApiResponse<NewsArticle>> {
    return apiClient.get<NewsArticle>(`/news/${id}`);
  },

  async createArticle(data: Partial<NewsArticle>): Promise<ApiResponse<NewsArticle>> {
    return apiClient.post<NewsArticle>('/news', data);
  },
};
```

## Testing

Test the API connection from any screen:

```typescript
import { healthApi } from '@/lib/api';
import config from '@/lib/config';

const testConnection = async () => {
  console.log('Testing API at:', config.api.baseUrl);
  
  const response = await healthApi.check();
  
  if (response.success) {
    console.log('✅ Connected:', response.data);
  } else {
    console.log('❌ Failed:', response.error?.message);
  }
};
```

## Best Practices

1. **Never hardcode URLs** - Always use the API client
2. **Handle errors gracefully** - Check `response.success` before using data
3. **Type your responses** - Use TypeScript interfaces for type safety
4. **Centralize API logic** - Add new endpoints to domain services in `api.ts`
5. **Log for debugging** - Use console.log in development to track API calls
6. **Use config** - Import from `@/lib/config` for environment values

## Common Patterns

### Loading States

```typescript
const [isLoading, setIsLoading] = useState(false);

const fetchData = async () => {
  setIsLoading(true);
  const response = await apiClient.get('/data');
  setIsLoading(false);
  
  if (response.success) {
    setData(response.data);
  }
};
```

### Error Display

```typescript
const [error, setError] = useState<string | null>(null);

const fetchData = async () => {
  setError(null);
  const response = await apiClient.get('/data');
  
  if (!response.success) {
    setError(response.error?.message || 'Failed to load data');
    return;
  }
  
  setData(response.data);
};
```

### Retry Logic

```typescript
const fetchWithRetry = async (maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    const response = await apiClient.get('/data');
    
    if (response.success) {
      return response.data;
    }
    
    if (i < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  
  throw new Error('Max retries exceeded');
};
```
