# Network Safety Implementation - Quick Reference

## What Changed?

This implementation adds comprehensive safeguards against data mismatches when switching between testnet and mainnet networks.

## Key Features

### 1. Config Validation ✅
- **File**: `lib/config.ts`
- **What it does**: Fails fast in production builds if mainnet endpoints are misconfigured
- **When it runs**: App startup
- **Impact**: Release builds with unset or localhost URLs will crash with clear error message

### 2. Cache Clearing on Environment Switch ✅
- **Files**: `contexts/EnvironmentContext.tsx`, `lib/cache.ts`
- **What it does**: Clears ALL cached data when switching environments
- **Data cleared**: Portfolio, balances, transactions, assets, images
- **Data preserved**: Wallet session, authentication, AsyncStorage keys
- **Impact**: Impossible to accidentally show testnet balances as mainnet

### 3. Mainnet Confirmation Dialog ✅
- **File**: `app/(tabs)/settings.tsx`
- **What it does**: Shows confirmation before switching to mainnet
- **Warning includes**: Risk of real assets, cache clearing, wallet re-selection needed
- **Impact**: Prevents accidental switches to production network

### 4. Network Visibility on Balance/Transaction Screens ✅
- **Files**: 
  - `app/(tabs)/portfolio.tsx`
  - `app/(tabs)/transaction-history.tsx`
- **What it does**: Shows NetworkBadge component on screens with balance/transaction data
- **Colors**: Green = Testnet, Red = Mainnet
- **Impact**: Users always know which network they're viewing

### 5. Comprehensive Tests ✅
- **Files**:
  - `lib/__tests__/config.test.ts` (enhanced)
  - `lib/__tests__/environment-switch.test.ts` (new)
- **Coverage**: Config validation, cache clearing, switching scenarios
- **Impact**: Tests prevent regressions and verify safety mechanisms

---

## For Developers

### Using the Environment Context

```typescript
import { useEnvironment } from '../../contexts/EnvironmentContext';

export function MyComponent() {
  const { environment, environmentConfig, setEnvironment, isMainnetConfigured } = useEnvironment();
  
  // Current network: 'testnet' or 'mainnet'
  console.log(`Active network: ${environment}`);
  
  // Config for current network
  console.log(`API URL: ${environmentConfig.apiBaseUrl}`);
  
  // Switch environment (clears cache automatically)
  const handleSwitch = async () => {
    if (environment === 'testnet') {
      await setEnvironment('mainnet');
    }
  };
  
  // Check if mainnet is available
  if (!isMainnetConfigured) {
    console.log('Mainnet not configured');
  }
}
```

### Using NetworkBadge

```typescript
import NetworkBadge from '../../components/NetworkBadge';

export function MyScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <NetworkBadge /> {/* Shows at top-right */}
      {/* Rest of screen content */}
    </SafeAreaView>
  );
}
```

### Cache Clearing

```typescript
import { CacheManager } from '../lib/cache';

// Clear all cache manually if needed
const cacheManager = CacheManager.getInstance();
await cacheManager.clear();

// Or clear specific entry
await cacheManager.remove('portfolio_data');
```

### Config Validation

```typescript
import { validateEnvironmentConfig } from '../lib/config';

// Automatically called at app startup by EnvironmentContext
// Throws in production if misconfigured
// Safe to call manually in development
try {
  validateEnvironmentConfig();
} catch (error) {
  console.error('Config validation failed:', error.message);
}
```

---

## Acceptance Criteria Checklist

- ✅ Switching environments clears cached data and requires wallet re-selection
  - CacheManager.clear() removes all cache entries
  - WalletContext detects network mismatch and requires reconnect
  
- ✅ Build with unset/localhost API URL fails fast in release config
  - validateEnvironmentConfig() throws error if endpoints misconfigured
  - Only in production mode (__DEV__ = false)
  
- ✅ Active network visible on every screen displaying balances/transactions
  - NetworkBadge added to portfolio.tsx
  - NetworkBadge added to transaction-history.tsx
  - Color-coded for quick recognition
  
- ✅ Mainnet selection requires explicit confirmation
  - Alert dialog appears before switching to mainnet
  - Shows warning about real assets and cache clearing
  - Cancel option available
  
- ✅ Tests cover switch path and config validation failure
  - config.test.ts: Tests config validation in dev and prod modes
  - environment-switch.test.ts: Tests cache clearing and switching scenarios

---

## File Structure

```
apps/mobile/
├── lib/
│   ├── config.ts                          [Modified] - Added validateEnvironmentConfig()
│   ├── cache.ts                           [Existing] - Has clear() method
│   └── __tests__/
│       ├── config.test.ts                 [Modified] - Enhanced with validation tests
│       └── environment-switch.test.ts     [New] - Tests for switching and cache clearing
├── contexts/
│   └── EnvironmentContext.tsx             [Modified] - Calls validation, clears cache on switch
├── app/(tabs)/
│   ├── portfolio.tsx                      [Modified] - Added NetworkBadge
│   ├── transaction-history.tsx            [Modified] - Added NetworkBadge
│   └── settings.tsx                       [Modified] - Added mainnet confirmation dialog
├── locales/
│   ├── en/common.json                     [Modified] - Added mainnet confirmation strings
│   └── zh/common.json                     [Modified] - Added Chinese translations
└── components/
    └── NetworkBadge.tsx                   [Existing] - Reused component
```

---

## Environment Variables

### Development
```
EXPO_PUBLIC_TESTNET_API_URL=http://localhost:3000/api
EXPO_PUBLIC_TESTNET_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

### Production (Required)
```
EXPO_PUBLIC_MAINNET_API_URL=https://api.production.example.com
EXPO_PUBLIC_MAINNET_SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org
EXPO_PUBLIC_TESTNET_API_URL=https://api.testnet.example.com
EXPO_PUBLIC_TESTNET_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

**WARNING**: Production builds MUST have these variables set. Builds will fail with clear error if any are missing or set to localhost.

---

## Error Messages Users May See

### Config Validation Error (Production Only)
```
FATAL: Mainnet API URL is not properly configured. 
Set EXPO_PUBLIC_MAINNET_API_URL to a valid production endpoint. 
Current value: "http://localhost:3000"
```

### Network Mismatch (After Switching Networks)
- **Status**: "network_mismatch"
- **Action**: User must reconnect wallet for new network
- **Automatic**: WalletContext handles this

---

## Testing Checklist

- [ ] Config validation tests pass: `npm test -- --testPathPattern="config"`
- [ ] Environment switch tests pass: `npm test -- --testPathPattern="environment-switch"`
- [ ] Manual test: Navigate to Settings > Network > switch to Mainnet > confirm dialog
- [ ] Manual test: Portfolio screen shows NetworkBadge
- [ ] Manual test: Transaction screen shows NetworkBadge
- [ ] Manual test: Cache is cleared after switch (no testnet data showing)
- [ ] Manual test: Wallet requires re-selection after switch

---

## Troubleshooting

### Issue: "Mainnet API URL is not properly configured" error on production build

**Solution**: Add environment variables to build configuration:
```bash
export EXPO_PUBLIC_MAINNET_API_URL=https://your-api.example.com
export EXPO_PUBLIC_MAINNET_SOROBAN_RPC_URL=https://your-soroban.example.com
# Then rebuild
eas build --platform ios --profile production
```

### Issue: Testnet data still showing after switching to mainnet

**Solution**: Cache should be cleared automatically. If still seeing old data:
1. Force restart the app
2. Navigate to Settings > Cache > Clear All Cache
3. Verify cache TTL values in lib/cache.ts are reasonable

### Issue: Wallet doesn't reconnect after network switch

**Solution**: Expected behavior. User must:
1. See the network_mismatch status
2. Tap "Reconnect" button
3. Follow wallet connection flow for new network

---

## Related Files

- Architecture: [ARCHITECTURE.md](document/ARCHITECTURE.md)
- Cache Implementation: [CACHING_IMPLEMENTATION.md](apps/mobile/CACHING_IMPLEMENTATION.md)
- Setup Guide: [SETUP_GUIDE.md](apps/mobile/SETUP_GUIDE.md)
- Contributing: [CONTRIBUTOR_README.md](apps/mobile/CONTRIBUTOR_README.md)

---

## Questions?

Refer to the detailed implementation summary in: `IMPLEMENTATION_SUMMARY_NETWORK_SAFETY.md`
