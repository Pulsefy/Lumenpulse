#![no_std]

mod errors;
mod events;
mod storage;

use errors::PricingAdapterError;
use soroban_sdk::{contract, contractimpl, Address, Env};
use storage::{DataKey, PriceState};

pub const BASE_DECIMALS: u32 = 7;
/// Default staleness window (seconds) used when no admin-configured value
/// has been set via `set_staleness_window`.
pub const DEFAULT_MAX_PRICE_AGE: u64 = 3600;

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
    /// `asset_decimals` specifies the decimal places of the original asset token.
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
            &DataKey::AssetPriceTimestamp(asset.clone()),
            &env.ledger().timestamp(),
        );
        // A freshly admin-provided price always supersedes any prior
        // invalidation.
        env.storage()
            .persistent()
            .set(&DataKey::AssetPriceInvalidated(asset.clone()), &false);

        let event = events::PriceUpdatedEvent {
            admin,
            asset,
            price,
        };
        event.publish(&env);
        Ok(())
    }

    /// Get the current configured price of an asset. Rejects deterministically
    /// if the price has been explicitly invalidated or has aged past the
    /// configured staleness window — this is the entry point consumers
    /// (including `normalize_amount`, which calls this internally) rely on
    /// to reject unsafe prices.
    pub fn get_price(env: Env, asset: Address) -> Result<i128, PricingAdapterError> {
        let price: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::AssetPrice(asset.clone()))
            .ok_or(PricingAdapterError::PriceNotFound)?;

        match Self::price_state(&env, &asset) {
            PriceState::Invalidated => return Err(PricingAdapterError::PriceInvalidated),
            PriceState::Stale => return Err(PricingAdapterError::StalePrice),
            PriceState::Fresh => {}
        }

        Ok(price)
    }

    /// Explicitly flag an asset's currently stored price as invalid (admin
    /// only), e.g. after detecting an oracle malfunction. The next
    /// successful `set_price` call for the asset clears the flag.
    pub fn invalidate_price(
        env: Env,
        admin: Address,
        asset: Address,
    ) -> Result<(), PricingAdapterError> {
        Self::require_admin(&env, &admin)?;
        if !env
            .storage()
            .persistent()
            .has(&DataKey::AssetPrice(asset.clone()))
        {
            return Err(PricingAdapterError::PriceNotFound);
        }
        env.storage()
            .persistent()
            .set(&DataKey::AssetPriceInvalidated(asset.clone()), &true);

        let event = events::PriceInvalidatedEvent { admin, asset };
        event.publish(&env);
        Ok(())
    }

    /// Set (or update) the global staleness window, in seconds (admin only).
    pub fn set_staleness_window(
        env: Env,
        admin: Address,
        max_age_seconds: u64,
    ) -> Result<(), PricingAdapterError> {
        Self::require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::MaxPriceAge, &max_age_seconds);

        let event = events::StalenessWindowUpdatedEvent {
            admin,
            max_age_seconds,
        };
        event.publish(&env);
        Ok(())
    }

    /// The currently configured staleness window, in seconds (defaults to
    /// `DEFAULT_MAX_PRICE_AGE` until an admin sets one explicitly).
    pub fn get_staleness_window(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::MaxPriceAge)
            .unwrap_or(DEFAULT_MAX_PRICE_AGE)
    }

    /// Freshness classification of an asset's stored price, without
    /// triggering `get_price`'s rejection — lets a consumer inspect state
    /// before deciding whether to call `get_price`.
    pub fn get_price_state(env: Env, asset: Address) -> Result<PriceState, PricingAdapterError> {
        if !env
            .storage()
            .persistent()
            .has(&DataKey::AssetPrice(asset.clone()))
        {
            return Err(PricingAdapterError::PriceNotFound);
        }
        Ok(Self::price_state(&env, &asset))
    }

    /// The ledger timestamp an asset's price was last set at.
    pub fn get_price_timestamp(env: Env, asset: Address) -> Result<u64, PricingAdapterError> {
        env.storage()
            .persistent()
            .get(&DataKey::AssetPriceTimestamp(asset))
            .ok_or(PricingAdapterError::PriceNotFound)
    }

    fn price_state(env: &Env, asset: &Address) -> PriceState {
        let invalidated: bool = env
            .storage()
            .persistent()
            .get(&DataKey::AssetPriceInvalidated(asset.clone()))
            .unwrap_or(false);
        if invalidated {
            return PriceState::Invalidated;
        }

        let timestamp: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::AssetPriceTimestamp(asset.clone()))
            .unwrap_or(0);
        let max_age: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MaxPriceAge)
            .unwrap_or(DEFAULT_MAX_PRICE_AGE);
        let age = env.ledger().timestamp().saturating_sub(timestamp);

        if age > max_age {
            PriceState::Stale
        } else {
            PriceState::Fresh
        }
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
