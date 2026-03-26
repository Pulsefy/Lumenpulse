/**
 * API Client Usage Examples
 * 
 * This file demonstrates common patterns for using the API client.
 * These are examples only - not meant to be imported or executed directly.
 */

import { apiClient, ApiResponse } from './api-client';
import { authApi, healthApi } from './api';
import config from './config';

// ============================================================================
// Example 1: Basic GET Request
// ============================================================================
async function exampleGetRequest() {
  interface User {
    id: string;
    email: string;
    name: string;
  }

  const response = await apiClient.get<User>('/users/me');

  if (response.success && response.data) {
    console.log('User:', response.data);
    return response.data;
  } else {
    console.error('Error:', response.error?.message);
    throw new Error(response.error?.message || 'Failed to fetch user');
  }
}

// ============================================================================
// Example 2: POST Request with Body
// ============================================================================
async function examplePostRequest() {
  interface CreateItemRequest {
    name: string;
    description: string;
  }

  interface CreateItemResponse {
    id: string;
    name: string;
    description: string;
    createdAt: string;
  }

  const newItem: CreateItemRequest = {
    name: 'My Item',
    description: 'Item description',
  };

  const response = await apiClient.post<CreateItemResponse>('/items', newItem);

  if (response.success && response.data) {
    console.log('Created item:', response.data);
    return response.data;
  } else {
    console.error('Failed to create item:', response.error);
    return null;
  }
}

// ============================================================================
// Example 3: Using Domain Services (Auth)
// ============================================================================
async function exampleAuthLogin() {
  const response = await authApi.login({
    email: 'user@example.com',
    password: 'password123',
  });

  if (response.success && response.data) {
    const { access_token, refresh_token } = response.data;
    
    // Store tokens (use your storage service)
    console.log('Login successful');
    
    // Set token for future requests
    apiClient.setAuthToken(access_token);
    
    return { access_token, refresh_token };
  } else {
    console.error('Login failed:', response.error?.message);
    throw new Error(response.error?.message || 'Login failed');
  }
}

// ============================================================================
// Example 4: Health Check
// ============================================================================
async function exampleHealthCheck() {
  console.log('Checking API health at:', config.api.baseUrl);
  
  const response = await healthApi.check();

  if (response.success && response.data) {
    console.log('✅ API is healthy:', response.data);
    return true;
  } else {
    console.log('❌ API health check failed:', response.error?.message);
    return false;
  }
}

// ============================================================================
// Example 5: Error Handling Pattern
// ============================================================================
async function exampleErrorHandling() {
  const response = await apiClient.get('/some-endpoint');

  // Pattern 1: Early return on error
  if (!response.success) {
    console.error('Request failed:', response.error?.message);
    return null;
  }

  // Pattern 2: Throw on error
  if (!response.success) {
    throw new Error(response.error?.message || 'Request failed');
  }

  // Pattern 3: Default value on error
  const data = response.success ? response.data : { default: 'value' };

  return data;
}

// ============================================================================
// Example 6: Custom Headers and Timeout
// ============================================================================
async function exampleCustomConfig() {
  const response = await apiClient.get('/endpoint', {
    headers: {
      'X-Custom-Header': 'custom-value',
    },
    timeout: 60000, // 60 seconds
  });

  return response;
}

// ============================================================================
// Example 7: Request Cancellation
// ============================================================================
async function exampleCancellation() {
  const controller = new AbortController();

  // Start request
  const requestPromise = apiClient.get('/slow-endpoint', {
    signal: controller.signal,
  });

  // Cancel after 5 seconds
  setTimeout(() => {
    controller.abort();
    console.log('Request cancelled');
  }, 5000);

  try {
    const response = await requestPromise;
    return response;
  } catch (error) {
    console.log('Request was cancelled or failed');
    return null;
  }
}

// ============================================================================
// Example 8: React Component Pattern
// ============================================================================
/*
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { apiClient } from '@/lib/api-client';

interface DataItem {
  id: string;
  name: string;
}

export function ExampleComponent() {
  const [data, setData] = useState<DataItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);

    const response = await apiClient.get<DataItem[]>('/items');

    if (response.success && response.data) {
      setData(response.data);
    } else {
      setError(response.error?.message || 'Failed to load data');
    }

    setIsLoading(false);
  };

  if (isLoading) {
    return <ActivityIndicator />;
  }

  if (error) {
    return <Text>Error: {error}</Text>;
  }

  return (
    <View>
      {data.map(item => (
        <Text key={item.id}>{item.name}</Text>
      ))}
    </View>
  );
}
*/

// ============================================================================
// Example 9: Retry Logic
// ============================================================================
async function exampleRetryLogic<T>(
  requestFn: () => Promise<ApiResponse<T>>,
  maxRetries = 3,
  delayMs = 1000,
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await requestFn();

    if (response.success && response.data) {
      return response.data;
    }

    // Don't retry on client errors (4xx)
    if (response.error?.statusCode && response.error.statusCode >= 400 && response.error.statusCode < 500) {
      throw new Error(response.error.message);
    }

    // Wait before retrying (exponential backoff)
    if (attempt < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }

  throw new Error('Max retries exceeded');
}

// Usage:
async function exampleUsingRetry() {
  try {
    const data = await exampleRetryLogic(
      () => apiClient.get<{ status: string }>('/health'),
      3,
      1000,
    );
    console.log('Success after retries:', data);
  } catch (error) {
    console.error('Failed after all retries:', error);
  }
}

// ============================================================================
// Example 10: Batch Requests
// ============================================================================
async function exampleBatchRequests() {
  // Execute multiple requests in parallel
  const [usersResponse, itemsResponse, settingsResponse] = await Promise.all([
    apiClient.get('/users'),
    apiClient.get('/items'),
    apiClient.get('/settings'),
  ]);

  return {
    users: usersResponse.success ? usersResponse.data : [],
    items: itemsResponse.success ? itemsResponse.data : [],
    settings: settingsResponse.success ? settingsResponse.data : {},
  };
}

// Export examples for reference (not for actual use)
export const examples = {
  exampleGetRequest,
  examplePostRequest,
  exampleAuthLogin,
  exampleHealthCheck,
  exampleErrorHandling,
  exampleCustomConfig,
  exampleCancellation,
  exampleRetryLogic,
  exampleBatchRequests,
};
