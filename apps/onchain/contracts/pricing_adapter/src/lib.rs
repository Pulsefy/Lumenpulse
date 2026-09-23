#![no_std]

mod errors;
mod events;
mod storage;

use errors::PricingAdapterError;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec};
use storage::{DataKey, PriceState, LEDGER_BUMP, LEDGER_THRESHOLD};

pub const BASE_DECIMALS: u32 = 7;
/// Default staleness window (seconds) used when no admin-configured value
/// has been set via `set_staleness_window`.
pub const DEFAULT_MAX_PRICE_AGE: u64 = 3600;

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct PriceData {
    pub price: i128,
    pub source: u32,
    pub age: u64,
}

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
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        let event = events::InitializedEvent { admin };
        event.publish(&env);
        Ok(())
    }

    /// Set the ordered list of price sources for an asset
    pub fn set_sources(
        env: Env,
        admin: Address,
        asset: Address,
        sources: Vec<u32>,
    ) -> Result<(), PricingAdapterError> {
        Self::require_admin(&env, &admin)?;
        env.storage()
            .persistent()
            .set(&DataKey::AssetSources(asset.clone()), &sources);
        Self::bump_asset_ttl(&env, &asset);

        let event = events::SourcesUpdatedEvent { admin, asset, sources };
        event.publish(&env);
        Ok(())
    }

    /// Set the price for a specific asset and source. Price should be scaled by 10^7 (BASE_DECIMALS).
    /// `asset_decimals` specifies the decimal places of the original asset token.
    pub fn set_price(
        env: Env,
        admin: Address,
        asset: Address,
        source: u32,
        price: i128,
        asset_decimals: u32,
    ) -> Result<(), PricingAdapterError> {
        Self::require_admin(&env, &admin)?;
        if price <= 0 {
            return Err(PricingAdapterError::InvalidPrice);
        }

        env.storage()
            .persistent()
            .set(&DataKey::AssetPrice(asset.clone(), source), &price);
        env.storage()
            .persistent()
            .set(&DataKey::AssetDecimals(asset.clone()), &asset_decimals);
        env.storage().persistent().set(
            &DataKey::AssetPriceTimestamp(asset.clone(), source),
            &env.ledger().timestamp(),
        );
        // A freshly admin-provided price always supersedes any prior
        // invalidation.
        env.storage()
            .persistent()
            .set(&DataKey::AssetPriceInvalidated(asset.clone(), source), &false);
        Self::bump_asset_ttl(&env, &asset);

        let event = events::PriceUpdatedEvent {
            admin,
            asset,
            source,
            price,
        };
        event.publish(&env);
        Ok(())
    }

    /// Get the current configured price of an asset, falling back through
    /// the configured sources if primary sources are stale or invalidated.
    /// Selection rule: sources are checked in the exact order they were
    /// provided to `set_sources`. The first source that is Fresh is returned.
    /// If no sources are configured or all are stale/invalidated, reverts with `NoValidSource`.
    pub fn get_price(env: Env, asset: Address) -> Result<PriceData, PricingAdapterError> {
        let sources: Vec<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::AssetSources(asset.clone()))
            .unwrap_or(Vec::new(&env));

        if sources.is_empty() {
            return Err(PricingAdapterError::NoValidSource);
        }

        for source in sources.into_iter() {
            if let Ok(state) = Self::get_price_state(env.clone(), asset.clone(), source) {
                if state == PriceState::Fresh {
                    let price: i128 = env
                        .storage()
                        .persistent()
                        .get(&DataKey::AssetPrice(asset.clone(), source))
                        .unwrap();
                    let timestamp: u64 = Self::get_price_timestamp(env.clone(), asset.clone(), source).unwrap();
                    let age = env.ledger().timestamp().saturating_sub(timestamp);
                    return Ok(PriceData {
                        price,
                        source,
                        age,
                    });
                }
            }
        }

        Err(PricingAdapterError::NoValidSource)
    }

    /// Explicitly flag an asset's currently stored price for a specific source
    /// as invalid (admin only), e.g. after detecting an oracle malfunction.
    pub fn invalidate_price(
        env: Env,
        admin: Address,
        asset: Address,
        source: u32,
    ) -> Result<(), PricingAdapterError> {
        Self::require_admin(&env, &admin)?;
        if !env
            .storage()
            .persistent()
            .has(&DataKey::AssetPrice(asset.clone(), source))
        {
            return Err(PricingAdapterError::PriceNotFound);
        }
        env.storage()
            .persistent()
            .set(&DataKey::AssetPriceInvalidated(asset.clone(), source), &true);
        Self::bump_asset_ttl(&env, &asset);

        let event = events::PriceInvalidatedEvent { admin, asset, source };
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
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

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

    /// Freshness classification of an asset's stored price for a specific source.
    pub fn get_price_state(env: Env, asset: Address, source: u32) -> Result<PriceState, PricingAdapterError> {
        if !env
            .storage()
            .persistent()
            .has(&DataKey::AssetPrice(asset.clone(), source))
        {
            return Err(PricingAdapterError::PriceNotFound);
        }
        Ok(Self::price_state(&env, &asset, source))
    }

    /// The ledger timestamp an asset's price was last set at for a specific source.
    pub fn get_price_timestamp(env: Env, asset: Address, source: u32) -> Result<u64, PricingAdapterError> {
        env.storage()
            .persistent()
            .get(&DataKey::AssetPriceTimestamp(asset, source))
            .ok_or(PricingAdapterError::PriceNotFound)
    }

    fn price_state(env: &Env, asset: &Address, source: u32) -> PriceState {
        // Touches instance storage (`MaxPriceAge`, alongside `Admin`) on
        // every price read, since this is the hottest read path in the
        // contract and admin writes alone may be too infrequent to keep the
        // instance TTL alive.
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Self::bump_asset_ttl(env, asset);

        let invalidated: bool = env
            .storage()
            .persistent()
            .get(&DataKey::AssetPriceInvalidated(asset.clone(), source))
            .unwrap_or(false);
        if invalidated {
            return PriceState::Invalidated;
        }

        let timestamp: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::AssetPriceTimestamp(asset.clone(), source))
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

        let price_data = Self::get_price(env.clone(), asset.clone())?;
        let price = price_data.price;
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
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

    fn bump_asset_ttl(env: &Env, asset: &Address) {
        let sources_key = DataKey::AssetSources(asset.clone());
        if env.storage().persistent().has(&sources_key) {
            env.storage()
                .persistent()
                .extend_ttl(&sources_key, LEDGER_THRESHOLD, LEDGER_BUMP);
            
            let sources: Vec<u32> = env
                .storage()
                .persistent()
                .get(&sources_key)
                .unwrap_or(Vec::new(env));
            
            for source in sources.into_iter() {
                for key in [
                    DataKey::AssetPrice(asset.clone(), source),
                    DataKey::AssetPriceTimestamp(asset.clone(), source),
                    DataKey::AssetPriceInvalidated(asset.clone(), source),
                ] {
                    if env.storage().persistent().has(&key) {
                        env.storage()
                            .persistent()
                            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
                    }
                }
            }
        }

        let decimals_key = DataKey::AssetDecimals(asset.clone());
        if env.storage().persistent().has(&decimals_key) {
            env.storage()
                .persistent()
                .extend_ttl(&decimals_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
    }
}

#[cfg(test)]
mod test;
