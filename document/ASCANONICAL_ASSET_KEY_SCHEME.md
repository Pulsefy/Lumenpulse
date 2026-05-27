# Canonical Asset Key Scheme

## Overview

This document defines the canonical asset identification system used across Lumenpulse to standardize asset identity representation across:
- Stellar Horizon (classic assets)
- Soroban tokens (smart contract tokens)
- Internal database

## Canonical Key Format

The canonical asset key uses the format: `{type}:{identifier}`

### Asset Types

#### 1. Native Assets (XLM)
- **Format**: `native:XLM`
- **Description**: Native Stellar Lumens
- **Issuer**: None (null)
- **Example**: `native:XLM`

#### 2. Credit Assets (Classic Stellar)
- **Format**: `credit:{code}:{issuer}`
- **Description**: Classic Stellar credit assets issued by accounts
- **Components**:
  - `code`: Asset code (e.g., USDC, BTC)
  - `issuer`: Stellar account public key (56 characters)
- **Example**: `credit:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`

#### 3. Soroban Tokens
- **Format**: `soroban:{contract_address}`
- **Description**: Soroban smart contract tokens
- **Components**:
  - `contract_address`: Soroban contract address
- **Example**: `soroban:CDLZFC3SYJYDZT7K67VY75OJECTNWDNKDPM7DLZKRPXRXKQZ7M5D37A`

## Type Definitions

### CanonicalAssetKey
```typescript
interface CanonicalAssetKey {
  type: AssetType;
  code?: string;           // For credit assets
  issuer?: string;          // For credit assets
  contractAddress?: string; // For Soroban tokens
}
```

### HorizonAsset
```typescript
interface HorizonAsset {
  assetType: string;        // 'native', 'credit_alphanum4', 'credit_alphanum12'
  assetCode?: string;
  assetIssuer?: string;
}
```

### SorobanAsset
```typescript
interface SorobanAsset {
  contractAddress: string;
  symbol?: string;
  decimals?: number;
}
```

### DatabaseAsset
```typescript
interface DatabaseAsset {
  assetCode: string;
  assetIssuer?: string | null;
}
```

### UnifiedAsset (UI-facing)
```typescript
interface UnifiedAsset {
  code: string;
  issuer: string | null;    // Always present, null for native/Soroban
  type: AssetType;
  contractAddress?: string; // For Soroban tokens
}
```

## Conversion Helpers

### String Conversion
- `canonicalKeyToString(key)`: Converts canonical key to string
- `stringToCanonicalKey(str)`: Parses string to canonical key

### Horizon Conversion
- `horizonToCanonical(horizon)`: Converts Horizon asset to canonical
- `canonicalToHorizon(key)`: Converts canonical to Horizon asset
- `horizonToUnified(horizon)`: Direct Horizon to UI asset conversion

### Soroban Conversion
- `sorobanToCanonical(soroban)`: Converts Soroban asset to canonical
- `canonicalToSoroban(key)`: Converts canonical to Soroban asset

### Database Conversion
- `databaseToCanonical(db)`: Converts database asset to canonical
- `canonicalToDatabase(key)`: Converts canonical to database asset
- `databaseToUnified(db)`: Direct DB to UI asset conversion

### Unified (UI) Conversion
- `canonicalToUnified(key)`: Converts canonical to UI asset
- `unifiedToCanonical(unified)`: Converts UI asset to canonical

### Utilities
- `isValidCanonicalKey(key)`: Validates canonical key
- `areCanonicalKeysEqual(key1, key2)`: Compares two keys for equality

## Usage Examples

### Converting Horizon Asset to Canonical
```typescript
import { horizonToCanonical, canonicalKeyToString } from './asset-key.converter';

const horizonAsset = {
  assetType: 'credit_alphanum4',
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
};

const canonical = horizonToCanonical(horizonAsset);
const keyString = canonicalKeyToString(canonical);
// Result: "credit:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
```

### Converting Database Asset to UI
```typescript
import { databaseToUnified } from './asset-key.converter';

const dbAsset = {
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
};

const unified = databaseToUnified(dbAsset);
// Result: { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', type: 'credit' }
```

### Handling Soroban Tokens
```typescript
import { sorobanToCanonical, canonicalToDatabase } from './asset-key.converter';

const sorobanToken = {
  contractAddress: 'CDLZFC3SYJYDZT7K67VY75OJECTNWDNKDPM7DLZKRPXRXKQZ7M5D37A',
  symbol: 'TOKEN',
  decimals: 7
};

const canonical = sorobanToCanonical(sorobanToken);
const dbAsset = canonicalToDatabase(canonical);
// Result: { assetCode: 'CDLZFC3SYJYDZT7K67VY75OJECTNWDNKDPM7DLZKRPXRXKQZ7M5D37A', assetIssuer: null }
```

## Database Storage Strategy

### Credit Assets
- Store `assetCode` as the asset code
- Store `assetIssuer` as the issuer public key
- Example: `{ assetCode: 'USDC', assetIssuer: 'GA5ZSE...' }`

### Native XLM
- Store `assetCode` as 'XLM'
- Store `assetIssuer` as null
- Example: `{ assetCode: 'XLM', assetIssuer: null }`

### Soroban Tokens
- Store `assetCode` as the contract address
- Store `assetIssuer` as null
- Example: `{ assetCode: 'CDLZFC3SYJYDZT7K67VY75OJECTNWDNKDPM7DLZKRPXRXKQZ7M5D37A', assetIssuer: null }`

## UI-Facing Fields

To ensure no issuer-loss in UI-facing fields:

1. **Always use the `UnifiedAsset` interface** for components that display asset information
2. **The `issuer` field is always present** (null for native/Soroban, string for credit assets)
3. **Display issuer information** when available (e.g., truncated public key)
4. **Use conversion helpers** when transforming data between layers

### Example UI Component
```typescript
interface AssetDisplayProps {
  asset: UnifiedAsset;
}

function AssetDisplay({ asset }: AssetDisplayProps) {
  return (
    <div>
      <span>{asset.code}</span>
      {asset.issuer && (
        <span className="issuer">
          {asset.issuer.slice(0, 8)}...{asset.issuer.slice(-8)}
        </span>
      )}
    </div>
  );
}
```

## Migration Guide

### Existing Code Using assetCode/assetIssuer
```typescript
// Before
const asset = { assetCode: 'USDC', assetIssuer: 'GA5ZSE...' };

// After
const dbAsset: DatabaseAsset = { assetCode: 'USDC', assetIssuer: 'GA5ZSE...' };
const unified = databaseToUnified(dbAsset);
```

### Existing Code Using code/issuer (UI)
```typescript
// Before
interface Asset {
  code: string;
  issuer?: string; // Optional - potential for issuer loss
}

// After
import { UnifiedAsset } from './asset-key.types';

// issuer is always present (can be null)
const asset: UnifiedAsset = {
  code: 'USDC',
  issuer: 'GA5ZSE...', // or null for native/Soroban
  type: AssetType.CREDIT
};
```

## Validation Rules

1. **Credit assets** must have both code and issuer
2. **Native assets** must be XLM with null issuer
3. **Soroban assets** must have a valid contract address
4. **Asset codes** for credit assets must be 1-12 characters
5. **Issuer addresses** must be valid Stellar public keys (56 characters)

## Testing

Test cases should cover:
- Conversion between all asset types
- Edge cases (null issuers, missing fields)
- Validation of invalid inputs
- Round-trip conversions (e.g., Horizon -> Canonical -> Horizon)
- UI rendering with various asset types

## References

- Implementation: `apps/backend/src/asset/asset-key.types.ts`
- Converters: `apps/backend/src/asset/asset-key.converter.ts`
