# Mobile App Caching Implementation

## Overview

This implementation provides offline-first data caching for the Lumenpulse mobile app, improving perceived speed and enabling offline functionality for key screens.

## Key Features

### 1. Automatic Caching

- **Transparent**: Data is cached automatically without user intervention
- **Stale-while-revalidate**: Shows cached data instantly while fetching fresh data in background
- **TTL-based expiration**: Different cache durations for different data types

### 2. Offline Support

- **Network detection**: Automatically detects online/offline status
- **Graceful degradation**: Shows cached data when offline
- **Background refresh**: Queues data refreshes when connectivity returns

### 3. Smart Cache Management

- **Configurable TTL**: Different cache lifetimes for different data types
- **Storage optimization**: Automatic cleanup of expired data
- **Memory efficient**: Uses AsyncStorage for persistence

## Architecture

### Core Components

#### `CacheManager` (`lib/cache.ts`)

- Singleton pattern for global cache management
- Handles network state monitoring
- Manages refresh queues for background updates
- Provides get/set/remove operations with TTL support

#### `useCachedData` Hook (`hooks/useCachedData.ts`)

- React hook for consuming cached data
- Handles loading states and error handling
- Provides refresh functionality
- Listens for background refresh events

#### `CachedApi` (`lib/cached-api.ts`)

- Wrapper around existing API calls
- Implements cache-first strategy
- Handles fallback to stale data when offline
- Provides preloading functionality

### Cache Configurations

```typescript
CACHE_CONFIGS = {
  PORTFOLIO: {
    ttl: 5 * 60 * 1000, // 5 minutes fresh
    maxAge: 30 * 60 * 1000, // 30 minutes max
    staleWhileRevalidate: true,
  },
  NEWS: {
    ttl: 10 * 60 * 1000, // 10 minutes fresh
    maxAge: 2 * 60 * 60 * 1000, // 2 hours max
    staleWhileRevalidate: true,
  },
  ASSETS: {
    ttl: 15 * 60 * 1000, // 15 minutes fresh
    maxAge: 60 * 60 * 1000, // 1 hour max
    staleWhileRevalidate: true,
  },
};
```

## Implementation Details

### 1. Screen Updates

#### Portfolio Screen

- Caches portfolio summary and recent transactions
- Shows stale data indicator when offline
- Pull-to-refresh updates cache
- Background refresh when connectivity returns

#### News Screen

- Caches news articles with 10-minute TTL
- Graceful offline fallback
- Visual indicators for cached/stale data

#### Discover Screen

- Caches asset list with 15-minute TTL
- Falls back to mock data when API unavailable
- Search functionality works on cached data

### 2. User Experience Improvements

#### Visual Indicators

- **Stale data banner**: Shows when displaying cached data
- **Offline indicator**: Global indicator for network status
- **Pull-to-refresh**: Standard refresh pattern for manual updates

#### Performance Optimizations

- **Instant loading**: Cached data shows immediately
- **Background updates**: Fresh data loads without blocking UI
- **Reduced API calls**: Serves data from cache when possible

### 3. Data Flow

```
1. Component mounts
2. Check cache for data
3. If cached data exists:
   - Show cached data immediately
   - Check if stale
   - If stale and online: fetch fresh data in background
4. If no cached data:
   - Show loading state
   - Fetch fresh data
   - Cache response
5. Handle offline scenarios:
   - Show cached data if available
   - Queue refresh for when online
```

## Usage Examples

### Basic Usage with Hook

```typescript
const { data, loading, error, refresh, isStale } = useCachedData({
  key: 'portfolio_summary',
  fetcher: () => portfolioApi.getSummary(),
  ...CACHE_CONFIGS.PORTFOLIO,
});
```

### Manual Cache Operations

```typescript
// Preload critical data
await CachedApi.preloadCriticalData(userId);

// Clear all cache
await CachedApi.clearCache();

// Get cached data directly
const cached = await cache.get('key', config);
```

## Configuration

### Cache Settings Screen

- **Location**: `app/settings/cache.tsx`
- **Features**:
  - Preload critical data for offline use
  - Clear all cached data
  - View cache status and network state
  - Educational information about caching

### Dependencies Added

```json
{
  "@react-native-community/netinfo": "^11.4.1"
}
```

## Benefits

### Performance

- **Instant loading**: Cached data appears immediately
- **Reduced bandwidth**: Less API calls when data is fresh
- **Better UX**: No loading spinners for cached content

### Offline Capability

- **Graceful degradation**: App works offline with cached data
- **Smart recovery**: Automatic refresh when connectivity returns
- **User awareness**: Clear indicators for offline/stale states

### Developer Experience

- **Simple API**: Easy to integrate with existing code
- **Configurable**: Different cache strategies per data type
- **Debuggable**: Clear cache states and error handling

## Future Enhancements

1. **Cache size management**: Implement LRU eviction
2. **Selective refresh**: Update specific cache entries
3. **Background sync**: Periodic data updates
4. **Cache analytics**: Track hit rates and performance
5. **Compression**: Reduce storage footprint for large datasets

## Testing

The caching system should be tested for:

- Online/offline transitions
- Cache expiration behavior
- Background refresh functionality
- Error handling and fallbacks
- Memory usage and performance impact
