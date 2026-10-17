# Fallback Price Sources

## Overview

The pricing adapter now supports an ordered list of price sources with automatic fallback when the primary source becomes stale or invalidated. This ensures dependent operations can continue even when individual price feeds experience issues.

## Architecture

### Source Selection Rule

The adapter iterates through sources in the configured order and returns the first **Fresh** price found:

1. Check primary source (first in list)
2. If primary is Stale or Invalidated, check next source
3. Continue until a Fresh price is found
4. If all sources are exhausted, revert with `AllSourcesExhausted`

### Storage Design

Each asset can have:
- **Legacy mode**: Single price using `AssetPrice(Address)` key (backward compatible)
- **Multi-source mode**: Ordered list of sources in `AssetPriceSources(Address)`

Each source stores independently:
- `SourcePrice(asset, source_id)` — the price value
- `SourcePriceTimestamp(asset, source_id)` — when it was set
- `SourcePriceInvalidated(asset, source_id)` — admin invalidation flag

## API

### Configuration (Admin Only)

```rust
/// Configure fallback chain for an asset
pub fn set_price_sources(
    env: Env,
    admin: Address,
    asset: Address,
    sources: Vec<BytesN<32>>,
) -> Result<(), PricingAdapterError>

/// Get configured sources for an asset
pub fn get_price_sources(env: Env, asset: Address) -> Vec<BytesN<32>>
```

### Price Management (Admin Only)

```rust
/// Set price for a specific source
pub fn set_source_price(
    env: Env,
    admin: Address,
    asset: Address,
    source_id: BytesN<32>,
    price: i128,
    asset_decimals: u32,
) -> Result<(), PricingAdapterError>

/// Invalidate a specific source
pub fn invalidate_source_price(
    env: Env,
    admin: Address,
    asset: Address,
    source_id: BytesN<32>,
) -> Result<(), PricingAdapterError>
```

### Price Queries

```rust
/// Get price with automatic fallback
pub fn get_price_with_fallback(
    env: Env,
    asset: Address,
) -> Result<PriceResult, PricingAdapterError>

/// PriceResult includes:
/// - price: i128 — the price value
/// - source_id: BytesN<32> — which source produced it
/// - age_seconds: u64 — how old the price is
```

### Source State Inspection

```rust
/// Check state of a specific source
pub fn get_source_price_state(
    env: Env,
    asset: Address,
    source_id: BytesN<32>,
) -> Result<PriceState, PricingAdapterError>
```

## Error Handling

### AllSourcesExhausted (Error Code 8)

Distinct from `PriceNotFound` and `StalePrice`:

- **Meaning**: All configured sources exist but are either stale or invalidated
- **Consumer action**: Must not proceed with a default price
- **Admin action**: Update at least one source or adjust staleness window

This prevents dependent operations from using outdated prices when all feeds fail.

## Backward Compatibility

### Legacy Single-Source Behavior

If no sources are configured (`AssetPriceSources` is empty or absent):
- `get_price_with_fallback()` falls back to legacy `get_price()` behavior
- Uses `AssetPrice(Address)` storage key
- Returns source_id `[0x00; 32]` to indicate default source

Existing contracts using `get_price()` continue to work unchanged.

### Migration Path

1. Continue using `set_price()` for single-source assets
2. For multi-source assets:
   - Call `set_price_sources()` with ordered list
   - Use `set_source_price()` for each source
   - Consumers call `get_price_with_fallback()` instead of `get_price()`

## Example Usage

### Configure Three-Tier Fallback

```rust
let source_chainlink = BytesN::from_array(&env, &[0x01; 32]);
let source_pyth = BytesN::from_array(&env, &[0x02; 32]);
let source_median = BytesN::from_array(&env, &[0x03; 32]);

let mut sources = Vec::new(&env);
sources.push_back(source_chainlink);
sources.push_back(source_pyth);
sources.push_back(source_median);

client.set_price_sources(&admin, &eth_asset, &sources);

// Set prices from each source
client.set_source_price(&admin, &eth_asset, &source_chainlink, &3000_0000000, &18);
client.set_source_price(&admin, &eth_asset, &source_pyth, &2995_0000000, &18);
client.set_source_price(&admin, &eth_asset, &source_median, &2998_0000000, &18);
```

### Query with Fallback

```rust
let result = client.get_price_with_fallback(&eth_asset)?;
// Returns price from first Fresh source, along with metadata:
// result.price — the price value
// result.source_id — which source provided it
// result.age_seconds — how old the data is
```

### Handle Oracle Failure

```rust
// Admin detects Chainlink malfunction
client.invalidate_source_price(&admin, &eth_asset, &source_chainlink);

// Consumers automatically fall through to Pyth without service disruption
let result = client.get_price_with_fallback(&eth_asset)?;
assert_eq!(result.source_id, source_pyth);
```

## Security Considerations

1. **No Silent Defaults**: When all sources fail, the contract reverts with `AllSourcesExhausted` rather than returning a potentially unsafe fallback value

2. **Source Ordering**: The admin-configured order determines precedence — choose the most reliable source as primary

3. **Staleness Windows**: All sources share the global `MaxPriceAge` setting. Adjust via `set_staleness_window()` based on asset volatility

4. **Admin Authority**: Only the configured admin can set sources, prices, or invalidate feeds — protect admin keys appropriately

## Test Coverage

Comprehensive test suite covers:
- ✅ Primary healthy returns primary price
- ✅ Primary stale with healthy fallback
- ✅ Primary invalidated with healthy fallback  
- ✅ All sources stale reverts with distinct error
- ✅ All sources invalidated reverts
- ✅ Multi-tier fallback chains (3+ sources)
- ✅ Backward compatibility with legacy single-source
- ✅ Source identification and age metadata
- ✅ Invalidation flag clearing on price update
- ✅ Authorization enforcement (admin-only operations)
- ✅ Distinct error codes for different failure modes

Run tests:
```bash
cargo test --package pricing_adapter
```

## Performance Notes

- **Storage**: Each source adds 3 persistent keys per asset (~192 bytes/source)
- **Gas**: Fallback iteration is linear in number of sources (O(n))
- **Recommendation**: Limit to 3-5 sources per asset for optimal performance
