# Pricing Adapter Contract

A foundational on-chain asset oracle and data normalization module for the Lumenpulse network. This contract maintains historical base asset valuations scaled to standard engine units, allowing downstream matching pools and application modules to compute relative quadratic weighting factors uniformly across multiple diverse collateral types.

---

## 🚀 Testnet Deployment Configuration

This contract is fully initialized and operational on the Stellar Testnet:

| Parameter Key | Value Reference |
| :--- | :--- |
| **Contract ID** | `CCW2EF3M5GXWM2ZTOAUPKC3CY7W42T3QJEK72WO7VEOR5ONBUTCUWDVM` |
| **Network Target** | Stellar Testnet (`testnet`) |
| **WASM Hash** | `477ccd47cbc96421dc872650ea2ab703b58195c3d16606b48813636cc669289f` |
| **Admin Address** | `GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY` |
| **Base Scaling Unit** | $10^7$ (`BASE_DECIMALS = 7`) |

---

## 🏗️ Compilation Mechanics

To compile the underlying static optimization matrix and build the raw WebAssembly blob from the workspace root:

```bash
# Analyze types and clippy rules
cargo clippy --all-targets

# Compile target binary payload
stellar contract build
```

## The optimized artifact drops to:

`target/wasm32v1-none/release/pricing_adapter.wasm`

## 🧠 Core Interface Specification

### Lifecycle & State Ingestion

#### `initialize(env: Env, admin: Address)`
Configures the primary oracle controller keys and commits structural permissions. Throws `AlreadyInitialized` if executed a second time.

#### `set_price(env: Env, admin: Address, asset: Address, price: i128, asset_decimals: u32)`
Injects or updates a specific token asset's reference token cost parameter. The stored price factor must be scaled by $10^7$. Requires explicit administrative authorization via `require_auth()`.

### Valuation Normalization Engine

#### `normalize_amount(env: Env, asset: Address, amount: i128) -> Result<i128, PricingAdapterError>`
Accepts a raw asset quantity, pulls down its configuration matrix, and normalizes the target value into standard network units utilizing the fixed integer scale formula:

$$\text{Normalized Amount} = \frac{\text{Amount} \times \text{Price}}{10^{\text{Asset Decimals}}}$$

## 📊 Read-Only State Resolvers

Downstream apps and telemetry collectors can fire off free RPC lookups to resolve prices instantly without paying gas:

```rust
// Fetch a specific asset's price scaled to 7 decimals
pub fn get_price(env: Env, asset: Address) -> Result<i128, PricingAdapterError>;

// Retrieve the base decimals configured for a target token
pub fn get_asset_decimals(env: Env, asset: Address) -> u32;

// Fetch the selected price with the id of its source and its age in seconds
pub fn get_price_quote(env: Env, asset: Address) -> Result<PriceQuote, PricingAdapterError>;
```

## Price sources and fallback

The adapter reads from an ordered list of price sources rather than a single feed, so a stale or invalidated price no longer halts every consumer while a backup source is healthy.

- Source `0` (`PRIMARY_SOURCE`) is the original feed. `set_price`, `invalidate_price`, `get_price_state` and `get_price_timestamp` keep working on it exactly as before.
- Any other `u32` id is an additional source with its own price, timestamp and invalidation flag per asset. An admin writes it with `set_source_price(admin, source, asset, price, asset_decimals)` (scaled by $10^7$ like `set_price`) and flags it with `invalidate_source_price(admin, source, asset)`. A source can be given prices before it is added to the list.
- `set_price_sources(admin, sources)` sets the order (admin only, 1 to `MAX_PRICE_SOURCES` = 5 distinct ids, any order) and `get_price_sources()` returns it. A contract that never had a list set reads `[0]`, so existing deployments keep their behavior without any migration.

**Selection rule.** `get_price`, `get_price_quote` and `normalize_amount` walk the list in order and answer from the first source whose price for the asset exists, is not invalidated and is no older than the staleness window. The window set with `set_staleness_window` applies to every source.

**Result.** `get_price_quote(asset)` returns `PriceQuote { price, source, age_seconds }`: the price, the id of the source that produced it and how old that price is at read time. `get_price` keeps returning the bare `i128`.

**When every source fails.** No default price is ever returned:

| Situation | Error |
| :--- | :--- |
| Two or more sources, none fresh and valid | `PriceSourcesExhausted` (8) |
| No source has a price for the asset | `PriceNotFound` (4) |
| Single source (the default list) | that source's own error: `PriceNotFound`, `PriceInvalidated` or `StalePrice`, as before |
| Invalid list passed to `set_price_sources` | `InvalidPriceSources` (9) |

**Events.** Answering from any source but the first publishes `price_source_fallback_event` (topics: version, asset; data: `source`, `skipped`, `age_seconds`), so operators can see when the primary was skipped. Admin changes publish `price_sources_updated_event`, `source_price_updated_event` and `source_price_invalidated_event`. These four events follow the event-versioning convention, with the schema version as the first topic.

---

