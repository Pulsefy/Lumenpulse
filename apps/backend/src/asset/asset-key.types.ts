/**
 * Canonical Asset Key Scheme
 *
 * This module defines a unified asset identification system that works across:
 * - Stellar Horizon (classic assets)
 * - Soroban tokens (smart contract tokens)
 * - Internal database
 *
 * Canonical Key Format: {type}:{identifier}
 *
 * Types:
 * - native:XLM                    - Native Stellar Lumens
 * - credit:{code}:{issuer}        - Classic credit assets (e.g., credit:USDC:GA5ZSE...)
 * - soroban:{contract_address}    - Soroban smart contract tokens
 */

/**
 * Asset type enum
 */
export enum AssetType {
  NATIVE = 'native',
  CREDIT = 'credit',
  SOROBAN = 'soroban',
}

/**
 * Canonical asset key interface
 */
export interface CanonicalAssetKey {
  type: AssetType;
  code?: string; // For credit assets
  issuer?: string; // For credit assets
  contractAddress?: string; // For Soroban tokens
}

/**
 * Horizon asset representation
 */
export interface HorizonAsset {
  assetType: string;
  assetCode?: string;
  assetIssuer?: string;
}

/**
 * Soroban token representation
 */
export interface SorobanAsset {
  contractAddress: string;
  symbol?: string;
  decimals?: number;
}

/**
 * Internal database asset representation
 */
export interface DatabaseAsset {
  assetCode: string;
  assetIssuer?: string | null;
}

/**
 * Unified asset interface for UI-facing fields
 * Ensures no issuer-loss by always including issuer field
 */
export interface UnifiedAsset {
  code: string;
  issuer: string | null;
  type: AssetType;
  contractAddress?: string; // For Soroban tokens
}
