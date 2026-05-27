import {
  CanonicalAssetKey,
  AssetType,
  HorizonAsset,
  SorobanAsset,
  DatabaseAsset,
  UnifiedAsset,
} from './asset-key.types';

/**
 * Converts a canonical asset key to string format
 * Format: {type}:{identifier}
 */
export function canonicalKeyToString(key: CanonicalAssetKey): string {
  switch (key.type) {
    case AssetType.NATIVE:
      return 'native:XLM';
    case AssetType.CREDIT:
      if (!key.code || !key.issuer) {
        throw new Error('Credit assets require both code and issuer');
      }
      return `credit:${key.code}:${key.issuer}`;
    case AssetType.SOROBAN:
      if (!key.contractAddress) {
        throw new Error('Soroban assets require contract address');
      }
      return `soroban:${key.contractAddress}`;
    default:
      throw new Error(`Unknown asset type: ${(key as any).type}`);
  }
}

/**
 * Parses a string into a canonical asset key
 */
export function stringToCanonicalKey(keyString: string): CanonicalAssetKey {
  const parts = keyString.split(':');
  const type = parts[0] as AssetType;

  switch (type) {
    case AssetType.NATIVE:
      if (parts.length !== 2 || parts[1] !== 'XLM') {
        throw new Error(`Invalid native asset key: ${keyString}`);
      }
      return { type: AssetType.NATIVE };
    case AssetType.CREDIT:
      if (parts.length !== 3) {
        throw new Error(`Invalid credit asset key: ${keyString}`);
      }
      return { type: AssetType.CREDIT, code: parts[1], issuer: parts[2] };
    case AssetType.SOROBAN:
      if (parts.length !== 2) {
        throw new Error(`Invalid Soroban asset key: ${keyString}`);
      }
      return { type: AssetType.SOROBAN, contractAddress: parts[1] };
    default:
      throw new Error(`Unknown asset type in key: ${keyString}`);
  }
}

/**
 * Converts Horizon asset to canonical key
 */
export function horizonToCanonical(horizon: HorizonAsset): CanonicalAssetKey {
  if (horizon.assetType === 'native') {
    return { type: AssetType.NATIVE };
  }

  if (
    horizon.assetType === 'credit_alphanum4' ||
    horizon.assetType === 'credit_alphanum12'
  ) {
    if (!horizon.assetCode || !horizon.assetIssuer) {
      throw new Error(
        'Credit assets require both assetCode and assetIssuer',
      );
    }
    return {
      type: AssetType.CREDIT,
      code: horizon.assetCode,
      issuer: horizon.assetIssuer,
    };
  }

  throw new Error(`Unsupported Horizon asset type: ${horizon.assetType}`);
}

/**
 * Converts canonical key to Horizon asset
 */
export function canonicalToHorizon(key: CanonicalAssetKey): HorizonAsset {
  switch (key.type) {
    case AssetType.NATIVE:
      return { assetType: 'native' };
    case AssetType.CREDIT:
      if (!key.code || !key.issuer) {
        throw new Error('Credit assets require both code and issuer');
      }
      // Determine asset type based on code length
      const assetType =
        key.code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12';
      return {
        assetType,
        assetCode: key.code,
        assetIssuer: key.issuer,
      };
    case AssetType.SOROBAN:
      throw new Error(
        'Soroban tokens cannot be directly converted to Horizon assets',
      );
    default:
      throw new Error(`Unknown asset type: ${(key as any).type}`);
  }
}

/**
 * Converts Soroban asset to canonical key
 */
export function sorobanToCanonical(soroban: SorobanAsset): CanonicalAssetKey {
  if (!soroban.contractAddress) {
    throw new Error('Soroban assets require contract address');
  }
  return {
    type: AssetType.SOROBAN,
    contractAddress: soroban.contractAddress,
  };
}

/**
 * Converts canonical key to Soroban asset
 */
export function canonicalToSoroban(key: CanonicalAssetKey): SorobanAsset {
  if (key.type !== AssetType.SOROBAN) {
    throw new Error('Only Soroban assets can be converted to Soroban format');
  }
  if (!key.contractAddress) {
    throw new Error('Soroban assets require contract address');
  }
  return {
    contractAddress: key.contractAddress,
  };
}

/**
 * Converts database asset to canonical key
 */
export function databaseToCanonical(db: DatabaseAsset): CanonicalAssetKey {
  // XLM (native asset)
  if (db.assetCode === 'XLM' && !db.assetIssuer) {
    return { type: AssetType.NATIVE };
  }

  // Credit asset
  if (db.assetIssuer) {
    return {
      type: AssetType.CREDIT,
      code: db.assetCode,
      issuer: db.assetIssuer,
    };
  }

  // If no issuer and not XLM, treat as potential Soroban token
  // (assuming assetCode is a contract address in this case)
  return {
    type: AssetType.SOROBAN,
    contractAddress: db.assetCode,
  };
}

/**
 * Converts canonical key to database asset
 */
export function canonicalToDatabase(key: CanonicalAssetKey): DatabaseAsset {
  switch (key.type) {
    case AssetType.NATIVE:
      return { assetCode: 'XLM', assetIssuer: null };
    case AssetType.CREDIT:
      if (!key.code || !key.issuer) {
        throw new Error('Credit assets require both code and issuer');
      }
      return { assetCode: key.code, assetIssuer: key.issuer };
    case AssetType.SOROBAN:
      if (!key.contractAddress) {
        throw new Error('Soroban assets require contract address');
      }
      // Store contract address as assetCode, issuer as null
      return { assetCode: key.contractAddress, assetIssuer: null };
    default:
      throw new Error(`Unknown asset type: ${(key as any).type}`);
  }
}

/**
 * Converts canonical key to unified asset (UI-facing)
 * Ensures no issuer-loss by always including issuer field
 */
export function canonicalToUnified(key: CanonicalAssetKey): UnifiedAsset {
  switch (key.type) {
    case AssetType.NATIVE:
      return { code: 'XLM', issuer: null, type: AssetType.NATIVE };
    case AssetType.CREDIT:
      if (!key.code || !key.issuer) {
        throw new Error('Credit assets require both code and issuer');
      }
      return {
        code: key.code,
        issuer: key.issuer,
        type: AssetType.CREDIT,
      };
    case AssetType.SOROBAN:
      if (!key.contractAddress) {
        throw new Error('Soroban assets require contract address');
      }
      return {
        code: key.contractAddress,
        issuer: null, // Soroban tokens don't have issuers in the traditional sense
        type: AssetType.SOROBAN,
        contractAddress: key.contractAddress,
      };
    default:
      throw new Error(`Unknown asset type: ${(key as any).type}`);
  }
}

/**
 * Converts unified asset (UI-facing) to canonical key
 */
export function unifiedToCanonical(unified: UnifiedAsset): CanonicalAssetKey {
  switch (unified.type) {
    case AssetType.NATIVE:
      if (unified.code !== 'XLM' || unified.issuer !== null) {
        throw new Error('Invalid native asset representation');
      }
      return { type: AssetType.NATIVE };
    case AssetType.CREDIT:
      if (!unified.issuer) {
        throw new Error('Credit assets require issuer');
      }
      return {
        type: AssetType.CREDIT,
        code: unified.code,
        issuer: unified.issuer,
      };
    case AssetType.SOROBAN:
      if (!unified.contractAddress) {
        throw new Error('Soroban assets require contract address');
      }
      return {
        type: AssetType.SOROBAN,
        contractAddress: unified.contractAddress,
      };
    default:
      throw new Error(`Unknown asset type: ${(unified as any).type}`);
  }
}

/**
 * Converts Horizon asset directly to unified asset (UI-facing)
 * This is a convenience helper for the common Horizon -> UI flow
 */
export function horizonToUnified(horizon: HorizonAsset): UnifiedAsset {
  const canonical = horizonToCanonical(horizon);
  return canonicalToUnified(canonical);
}

/**
 * Converts database asset directly to unified asset (UI-facing)
 * This is a convenience helper for the common DB -> UI flow
 */
export function databaseToUnified(db: DatabaseAsset): UnifiedAsset {
  const canonical = databaseToCanonical(db);
  return canonicalToUnified(canonical);
}

/**
 * Validates if a canonical key is valid
 */
export function isValidCanonicalKey(key: CanonicalAssetKey): boolean {
  try {
    canonicalKeyToString(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compares two canonical keys for equality
 */
export function areCanonicalKeysEqual(
  key1: CanonicalAssetKey,
  key2: CanonicalAssetKey,
): boolean {
  return canonicalKeyToString(key1) === canonicalKeyToString(key2);
}
