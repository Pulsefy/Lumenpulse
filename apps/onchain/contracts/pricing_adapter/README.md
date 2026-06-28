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
```

---

