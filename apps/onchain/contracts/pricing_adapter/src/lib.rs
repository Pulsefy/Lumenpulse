#![no_std]

mod errors;
mod events;
mod storage;

use errors::PricingAdapterError;
use soroban_sdk::{contract, contractimpl, Address, Env};
use storage::{DataKey, PriceData};

pub const BASE_DECIMALS: u32 = 7;

#[contract]
pub struct PricingAdapterContract;

#[contractimpl]
impl PricingAdapterContract {
    /// Initialize the contract with an admin address
    pub fn initialize(env: Env, admin: Address) -> Result<(), PricingAdapterError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(PricingAdapterError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);

        let event = events::InitializedEvent { admin };
        event.publish(&env);
        Ok(())
    }

    /// Set the price for a specific asset. Price should be scaled by 10^7 (BASE_DECIMALS).
    /// Records the current ledger timestamp and clears any prior invalidation flag.
    pub fn set_price(
        env: Env,
        admin: Address,
        asset: Address,
        price: i128,
        asset_decimals: u32,
    ) -> Result<(), PricingAdapterError> {
        Self::require_admin(&env, &admin)?;
        if price <= 0 {
            return Err(PricingAdapterError::InvalidPrice);
        }

        env.storage()
            .persistent()
            .set(&DataKey::AssetPrice(asset.clone()), &price);
        env.storage()
            .persistent()
            .set(&DataKey::AssetDecimals(asset.clone()), &asset_decimals);
        env.storage().persistent().set(
            &DataKey::PriceTimestamp(asset.clone()),
            &env.ledger().timestamp(),
        );
        // A fresh price clears any prior explicit invalidation.
        env.storage()
            .persistent()
            .set(&DataKey::PriceInvalidated(asset.clone()), &false);

        let event = events::PriceUpdatedEvent {
            admin,
            asset,
            price,
        };
        event.publish(&env);
        Ok(())
    }

    /// Configure the maximum age (in seconds) a price may have before it is
    /// considered stale. Set to 0 to disable the staleness check for this asset.
    pub fn set_staleness_window(
        env: Env,
        admin: Address,
        asset: Address,
        window: u64,
    ) -> Result<(), PricingAdapterError> {
        Self::require_admin(&env, &admin)?;
        env.storage()
            .persistent()
            .set(&DataKey::StalenessWindow(asset.clone()), &window);
        events::StalenessWindowSetEvent {
            asset,
            admin,
            window,
        }
        .publish(&env);
        Ok(())
    }

    /// Explicitly mark the current price for an asset as invalid. Downstream
    /// calls to get_safe_price will return PriceInvalidated until a new price
    /// is set with set_price.
    pub fn invalidate_price(
        env: Env,
        admin: Address,
        asset: Address,
    ) -> Result<(), PricingAdapterError> {
        Self::require_admin(&env, &admin)?;
        // Require the price to exist before allowing invalidation.
        env.storage()
            .persistent()
            .get::<_, i128>(&DataKey::AssetPrice(asset.clone()))
            .ok_or(PricingAdapterError::PriceNotFound)?;
        env.storage()
            .persistent()
            .set(&DataKey::PriceInvalidated(asset.clone()), &true);
        events::PriceInvalidatedEvent { asset, admin }.publish(&env);
        Ok(())
    }

    /// Get the raw stored price without any validity checks (backward-compatible).
    pub fn get_price(env: Env, asset: Address) -> Result<i128, PricingAdapterError> {
        env.storage()
            .persistent()
            .get(&DataKey::AssetPrice(asset))
            .ok_or(PricingAdapterError::PriceNotFound)
    }

    /// Get the price only if it is fresh and not invalidated.
    /// Returns PriceStale or PriceInvalidated if either condition is true.
    pub fn get_safe_price(env: Env, asset: Address) -> Result<i128, PricingAdapterError> {
        let price = Self::get_price(env.clone(), asset.clone())?;
        Self::check_price_validity(&env, &asset, price)
    }

    /// Return the full price state including freshness metadata and derived
    /// validity flags. Useful for dashboards and debugging; does not error on
    /// stale or invalidated prices — callers inspect the fields themselves.
    pub fn get_price_data(env: Env, asset: Address) -> Result<PriceData, PricingAdapterError> {
        let price = Self::get_price(env.clone(), asset.clone())?;
        let timestamp: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::PriceTimestamp(asset.clone()))
            .unwrap_or(0);
        let staleness_window: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::StalenessWindow(asset.clone()))
            .unwrap_or(0);
        let is_invalidated: bool = env
            .storage()
            .persistent()
            .get(&DataKey::PriceInvalidated(asset.clone()))
            .unwrap_or(false);
        let is_stale = staleness_window > 0
            && env.ledger().timestamp().saturating_sub(timestamp) > staleness_window;
        Ok(PriceData {
            price,
            timestamp,
            staleness_window,
            is_invalidated,
            is_stale,
        })
    }

    /// Get the decimals configured for an asset (defaults to 7)
    pub fn get_asset_decimals(env: Env, asset: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::AssetDecimals(asset))
            .unwrap_or(BASE_DECIMALS)
    }

    /// Normalizes an asset amount into its base equivalent value (scaled to 7 decimals).
    pub fn normalize_amount(
        env: Env,
        asset: Address,
        amount: i128,
    ) -> Result<i128, PricingAdapterError> {
        if amount == 0 {
            return Ok(0);
        }

        let price = Self::get_price(env.clone(), asset.clone())?;
        let decimals = Self::get_asset_decimals(env.clone(), asset);

        // Normalized amount = (amount * price) / 10^asset_decimals
        let base: i128 = 10;
        let denominator = base.pow(decimals);

        let normalized = amount
            .checked_mul(price)
            .and_then(|v| v.checked_div(denominator))
            .unwrap_or(0);

        Ok(normalized)
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /// Returns `price` unchanged if it passes both the invalidation flag check
    /// and the staleness window check; otherwise returns the appropriate error.
    /// `age > window` is the comparison so that a price exactly `window`
    /// seconds old is still considered fresh.
    fn check_price_validity(
        env: &Env,
        asset: &Address,
        price: i128,
    ) -> Result<i128, PricingAdapterError> {
        if env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::PriceInvalidated(asset.clone()))
            .unwrap_or(false)
        {
            return Err(PricingAdapterError::PriceInvalidated);
        }

        let window: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::StalenessWindow(asset.clone()))
            .unwrap_or(0);
        if window > 0 {
            let timestamp: u64 = env
                .storage()
                .persistent()
                .get(&DataKey::PriceTimestamp(asset.clone()))
                .unwrap_or(0);
            let age = env.ledger().timestamp().saturating_sub(timestamp);
            if age > window {
                return Err(PricingAdapterError::PriceStale);
            }
        }

        Ok(price)
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), PricingAdapterError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(PricingAdapterError::NotInitialized)?;
        if caller != &admin {
            return Err(PricingAdapterError::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }
}

#[cfg(test)]
mod test;
