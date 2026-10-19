#![no_std]

mod errors;
mod events;
mod storage;

use errors::PricingAdapterError;
use soroban_sdk::{contract, contractimpl, vec, Address, Env, Vec};
use storage::{DataKey, PriceQuote, PriceState, SourcePriceRecord, LEDGER_BUMP, LEDGER_THRESHOLD};

pub const BASE_DECIMALS: u32 = 7;
/// Default staleness window (seconds) used when no admin-configured value
/// has been set via `set_staleness_window`.
pub const DEFAULT_MAX_PRICE_AGE: u64 = 3600;
/// Id of the source `set_price` writes to, the contract's original single
/// price feed. It is the only entry of the source list until an admin sets
/// one with `set_price_sources`.
pub const PRIMARY_SOURCE: u32 = 0;
/// Upper bound on the source list, so a price read stays cheap.
pub const MAX_PRICE_SOURCES: u32 = 5;

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
        Self::bump_asset_ttl(&env, &asset);

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
        // The source selection rule documented on `select_price` decides
        // which source answers. With the default single source this behaves
        // exactly as before.
        Ok(Self::select_price(&env, &asset)?.price)
    }

    /// Same selection as `get_price`, returning the price together with the
    /// id of the source that produced it and how old that price is.
    pub fn get_price_quote(env: Env, asset: Address) -> Result<PriceQuote, PricingAdapterError> {
        Self::select_price(&env, &asset)
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
        Self::bump_asset_ttl(&env, &asset);

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

    /// Replace the ordered list of price sources (admin only).
    ///
    /// Price reads walk this list in order and answer from the first source
    /// whose price for the asset exists, is not invalidated and is within the
    /// staleness window. The list holds 1 to `MAX_PRICE_SOURCES` distinct
    /// ids and does not have to start with `PRIMARY_SOURCE`, so reordering
    /// it is how an admin promotes a backup feed.
    pub fn set_price_sources(
        env: Env,
        admin: Address,
        sources: Vec<u32>,
    ) -> Result<(), PricingAdapterError> {
        Self::require_admin(&env, &admin)?;
        Self::validate_sources(&env, &sources)?;
        env.storage()
            .instance()
            .set(&DataKey::PriceSources, &sources);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        events::publish_price_sources_updated(&env, admin, sources);
        Ok(())
    }

    /// The ordered list of price source ids. Until `set_price_sources` is
    /// called it is `[PRIMARY_SOURCE]`, so existing deployments keep reading
    /// the single source they always had.
    pub fn get_price_sources(env: Env) -> Vec<u32> {
        env.storage()
            .instance()
            .get(&DataKey::PriceSources)
            .unwrap_or_else(|| vec![&env, PRIMARY_SOURCE])
    }

    /// Set the price a source reports for an asset (admin only), scaled by
    /// 10^7 like `set_price`, which this is for `PRIMARY_SOURCE`.
    ///
    /// Any other id gets its own record with its own timestamp and
    /// invalidation flag. A source can receive prices before it is added to
    /// the list, so a backup feed can be filled before it is enabled.
    pub fn set_source_price(
        env: Env,
        admin: Address,
        source: u32,
        asset: Address,
        price: i128,
        asset_decimals: u32,
    ) -> Result<(), PricingAdapterError> {
        if source == PRIMARY_SOURCE {
            return Self::set_price(env, admin, asset, price, asset_decimals);
        }
        Self::require_admin(&env, &admin)?;
        if price <= 0 {
            return Err(PricingAdapterError::InvalidPrice);
        }

        let key = DataKey::SourcePrice(source, asset.clone());
        let record = SourcePriceRecord {
            price,
            timestamp: env.ledger().timestamp(),
            invalidated: false,
        };
        env.storage().persistent().set(&key, &record);
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        let decimals_key = DataKey::AssetDecimals(asset.clone());
        env.storage()
            .persistent()
            .set(&decimals_key, &asset_decimals);
        env.storage()
            .persistent()
            .extend_ttl(&decimals_key, LEDGER_THRESHOLD, LEDGER_BUMP);

        events::publish_source_price_updated(&env, admin, source, asset, price);
        Ok(())
    }

    /// Flag the price a source holds for an asset as invalid (admin only), so
    /// price reads skip that source until its next `set_source_price`. For
    /// `PRIMARY_SOURCE` this is `invalidate_price`.
    pub fn invalidate_source_price(
        env: Env,
        admin: Address,
        source: u32,
        asset: Address,
    ) -> Result<(), PricingAdapterError> {
        if source == PRIMARY_SOURCE {
            return Self::invalidate_price(env, admin, asset);
        }
        Self::require_admin(&env, &admin)?;
        let key = DataKey::SourcePrice(source, asset.clone());
        let mut record: SourcePriceRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(PricingAdapterError::PriceNotFound)?;
        record.invalidated = true;
        env.storage().persistent().set(&key, &record);
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);

        events::publish_source_price_invalidated(&env, admin, source, asset);
        Ok(())
    }

    fn price_state(env: &Env, asset: &Address) -> PriceState {
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
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

    /// Extends the TTL of the four persistent keys that make up an asset's
    /// price record (`AssetPrice`, `AssetDecimals`, `AssetPriceTimestamp`,
    /// `AssetPriceInvalidated`) together, so they always expire as a unit.
    fn bump_asset_ttl(env: &Env, asset: &Address) {
        for key in [
            DataKey::AssetPrice(asset.clone()),
            DataKey::AssetDecimals(asset.clone()),
            DataKey::AssetPriceTimestamp(asset.clone()),
            DataKey::AssetPriceInvalidated(asset.clone()),
        ] {
            env.storage()
                .persistent()
                .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
    }

    /// The source selection rule behind `get_price`, `get_price_quote` and
    /// `normalize_amount`.
    ///
    /// Sources are tried in the order of `get_price_sources`, and the first
    /// one whose price for `asset` exists, is not invalidated and is no older
    /// than the staleness window answers. Answering from any source but the
    /// first publishes `PriceSourceFallbackEvent`. No default price is ever
    /// returned: with two or more sources and none usable, the read reverts
    /// with `PriceSourcesExhausted` (or `PriceNotFound` when no source has a
    /// price for the asset at all). With a single source it reverts with that
    /// source's own error, as `get_price` always did.
    fn select_price(env: &Env, asset: &Address) -> Result<PriceQuote, PricingAdapterError> {
        // Same instance bump as `price_state`, so reads answered by a
        // non-primary source also keep the instance and the source list alive.
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        let sources = Self::get_price_sources(env.clone());
        let mut last_error = PricingAdapterError::PriceNotFound;
        for (position, source) in sources.iter().enumerate() {
            let (price, age_seconds) = match Self::read_source(env, source, asset) {
                Ok(reading) => reading,
                Err(PricingAdapterError::PriceNotFound) => continue,
                Err(error) => {
                    last_error = error;
                    continue;
                }
            };
            if position > 0 {
                events::publish_fallback(env, asset, source, position as u32, age_seconds);
            }
            return Ok(PriceQuote {
                price,
                source,
                age_seconds,
            });
        }

        if sources.len() > 1 && last_error != PricingAdapterError::PriceNotFound {
            return Err(PricingAdapterError::PriceSourcesExhausted);
        }
        Err(last_error)
    }

    /// One source's price for `asset` and its age in seconds, or the reason
    /// the selection rule skips it: `PriceNotFound`, then `PriceInvalidated`,
    /// then `StalePrice`, the precedence `get_price` has always applied.
    fn read_source(
        env: &Env,
        source: u32,
        asset: &Address,
    ) -> Result<(i128, u64), PricingAdapterError> {
        let now = env.ledger().timestamp();
        if source == PRIMARY_SOURCE {
            let price: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::AssetPrice(asset.clone()))
                .ok_or(PricingAdapterError::PriceNotFound)?;
            match Self::price_state(env, asset) {
                PriceState::Invalidated => return Err(PricingAdapterError::PriceInvalidated),
                PriceState::Stale => return Err(PricingAdapterError::StalePrice),
                PriceState::Fresh => {}
            }
            let timestamp: u64 = env
                .storage()
                .persistent()
                .get(&DataKey::AssetPriceTimestamp(asset.clone()))
                .unwrap_or(0);
            return Ok((price, now.saturating_sub(timestamp)));
        }

        let key = DataKey::SourcePrice(source, asset.clone());
        let record: SourcePriceRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(PricingAdapterError::PriceNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        if record.invalidated {
            return Err(PricingAdapterError::PriceInvalidated);
        }
        let age = now.saturating_sub(record.timestamp);
        if age > Self::get_staleness_window(env.clone()) {
            return Err(PricingAdapterError::StalePrice);
        }
        Ok((record.price, age))
    }

    /// Rejects a source list that is empty, longer than `MAX_PRICE_SOURCES`
    /// or names the same source twice.
    fn validate_sources(env: &Env, sources: &Vec<u32>) -> Result<(), PricingAdapterError> {
        if sources.is_empty() || sources.len() > MAX_PRICE_SOURCES {
            return Err(PricingAdapterError::InvalidPriceSources);
        }
        let mut seen: Vec<u32> = Vec::new(env);
        for source in sources.iter() {
            if seen.contains(source) {
                return Err(PricingAdapterError::InvalidPriceSources);
            }
            seen.push_back(source);
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
