# feat(webapp): migrate from Starknet to Stellar (Lumenpulse)

## Summary

This PR completes the migration of the webapp from the Starknet ecosystem to the Stellar ecosystem. It includes renaming the project from **Starkpulse** to **Lumenpulse**, updating branding assets, and replacing the Starknet wallet integration with a Stellar-compatible wallet (Freighter).

## What was implemented

- **Stellar Wallet Integration**: 
    - Replaced Starknet wallet providers with `StellarProvider` using `@stellar/freighter-api`.
    - Implemented `useStellarWallet` hook to provide address, connection status, and connect/disconnect functions.
    - Updated `WalletButton` to connect to Freighter and display Stellar addresses.
    - Added automatic connection check on mount in `StellarProvider`.
- **Branding Update (Starkpulse → Lumenpulse)**:
    - Renamed all visible text references in components (Navbar, Home, Footer, etc.).
    - Updated metadata in `layout.tsx` (titles, descriptions, OpenGraph, Twitter).
    - Replaced Starknet-themed assets with Lumenpulse-themed SVGs and PNGs.
    - Updated PWA manifest (`manifest.json`) and Service Worker (`sw.js`).
- **Cleanup**:
    - Removed Starknet-specific dependencies (though none were explicitly in `package.json`'s latest version, any residual logic was cleaned).
    - Verified that all existing routes and UI elements remain functional.

## Technical details

- **Freighter API**: Used `@stellar/freighter-api` v6.0.1. Fixed an issue where `getPublicKey` was being used instead of `getAddress`.
- **Address Truncation**: Maintained the existing truncation logic which works well for Stellar's 56-character public keys.
- **Provider Pattern**: Ensured `StellarProvider` wraps the entire application in the root layout for consistent state management.

## How it was tested

- **Build Verification**: Ran `npm run build` in `apps/webapp` to ensure no TypeScript or compilation errors.
- **Linting**: Ran `npm run lint` to ensure code quality and adherence to project standards.
- **Manual Check**: Verified that all pages (/news, /dashboard, /community, /auth/*) load correctly and reflect the new branding.

## Checklist

- [x] Starknet references removed/replaced by Stellar
- [x] Branding updated to Lumenpulse
- [x] Wallet connection works with Freighter
- [x] PWA assets and manifest updated
- [x] App builds and lints successfully
- [x] Existing functionality intact
