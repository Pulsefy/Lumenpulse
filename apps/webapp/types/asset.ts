/**
 * Shared UI Asset Types
 * 
 * This file defines standardized asset types for UI components.
 * Ensures no issuer-loss by making issuer field always present (can be null).
 */

import { AssetType } from '../../backend/src/asset/asset-key.types';

/**
 * Unified asset interface for UI-facing fields
 * Ensures no issuer-loss by always including issuer field
 */
export interface UIAsset {
  code: string;
  issuer: string | null; // Always present, null for native/Soroban
  balance?: string;
  type?: AssetType;
  contractAddress?: string; // For Soroban tokens
}

/**
 * Asset with balance for portfolio displays
 */
export interface AssetWithBalance extends UIAsset {
  balance: string;
  valueUsd?: number;
}

/**
 * Asset selection callback type
 */
export type AssetSelectCallback = (asset: UIAsset) => void;
