#![no_std]

mod errors;
mod events;
mod storage;

use errors::PricingAdapterError;
use soroban_sdk::{contract, contractimpl, Address, Env, Vec};
use storage::{DataKey, PriceState, SourceReport, LEDGER_BUMP, LEDGER_THRESHOLD};

pub const BASE_DECIMALS: u32 = 7;
/// Default staleness window (seconds) used when no admin-configured value
/// has been set via `set_staleness_window`.
pub const DEFAULT_MAX_PRICE_AGE: u64 = 3600;
/// Default maximum deviation (basis points) of a source from the
/// cross-source median.
pub const DEFAULT_MAX_DEVIATION_BPS: u32 = 500;
/// Minimum number of fresh sources needed for an aggregated price.
pub const MIN_SOURCES: u32 = 2;
/// Maximum registered sources per asset (bounds aggregation cost).
pub const MAX_SOURCES: u32 = 7;

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

    // ── Multi-source pricing with a cross-source deviation bound ─────────

    /// Register a price source for an asset (admin only).
    pub fn add_source(
        env: Env,
        admin: Address,
        asset: Address,
        source: Address,
    ) -> Result<(), PricingAdapterError> {
        Self::require_admin(&env, &admin)?;
        let mut sources = Self::sources_of(&env, &asset);
        if sources.contains(&source) {
            return Err(PricingAdapterError::SourceAlreadyRegistered);
        }
        if sources.len() >= MAX_SOURCES {
            return Err(PricingAdapterError::TooManySources);
        }
        sources.push_back(source);
        env.storage()
            .persistent()
            .set(&DataKey::Sources(asset.clone()), &sources);
        Self::bump_sources_ttl(&env, &asset);
        Ok(())
    }

    /// Remove a registered price source and its last report (admin only).
    pub fn remove_source(
        env: Env,
        admin: Address,
        asset: Address,
        source: Address,
    ) -> Result<(), PricingAdapterError> {
        Self::require_admin(&env, &admin)?;
        let mut sources = Self::sources_of(&env, &asset);
        let idx = sources
            .first_index_of(&source)
            .ok_or(PricingAdapterError::SourceNotRegistered)?;
        sources.remove(idx);
        env.storage()
            .persistent()
            .set(&DataKey::Sources(asset.clone()), &sources);
        env.storage()
            .persistent()
            .remove(&DataKey::SourceReport(asset.clone(), source));
        Self::bump_sources_ttl(&env, &asset);
        Ok(())
    }

    /// The sources currently registered for an asset.
    pub fn get_sources(env: Env, asset: Address) -> Vec<Address> {
        Self::sources_of(&env, &asset)
    }

    /// A registered source reports its latest price for an asset (scaled by
    /// 10^7). Stamped with the current ledger timestamp.
    pub fn report_price(
        env: Env,
        source: Address,
        asset: Address,
        price: i128,
    ) -> Result<(), PricingAdapterError> {
        source.require_auth();
        if !Self::sources_of(&env, &asset).contains(&source) {
            return Err(PricingAdapterError::SourceNotRegistered);
        }
        if price <= 0 {
            return Err(PricingAdapterError::InvalidPrice);
        }
        env.storage().persistent().set(
            &DataKey::SourceReport(asset.clone(), source),
            &SourceReport {
                price,
                timestamp: env.ledger().timestamp(),
            },
        );
        Self::bump_sources_ttl(&env, &asset);
        Ok(())
    }

    /// Set the maximum allowed deviation, in basis points, between a source
    /// and the cross-source median (admin only). Must be in `1..=10_000`.
    pub fn set_max_deviation_bps(
        env: Env,
        admin: Address,
        bps: u32,
    ) -> Result<(), PricingAdapterError> {
        Self::require_admin(&env, &admin)?;
        if bps == 0 || bps > 10_000 {
            return Err(PricingAdapterError::InvalidDeviationBound);
        }
        env.storage().instance().set(&DataKey::MaxDeviationBps, &bps);
        Ok(())
    }

    /// The configured deviation bound in basis points (defaults to
    /// `DEFAULT_MAX_DEVIATION_BPS`).
    pub fn get_max_deviation_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::MaxDeviationBps)
            .unwrap_or(DEFAULT_MAX_DEVIATION_BPS)
    }

    /// Manipulation-resistant price for an asset.
    ///
    /// Considers only fresh source reports. Requires at least `MIN_SOURCES`
    /// of them (`InsufficientSources` otherwise). The median is the
    /// reference; reports within the deviation bound of it are inliers. A
    /// strict majority of fresh sources must be inliers, otherwise the call
    /// fails closed with `SourcesDisagree`. The result is the median of the
    /// inliers, so a single compromised source cannot move it beyond the
    /// bound.
    pub fn get_aggregated_price(env: Env, asset: Address) -> Result<i128, PricingAdapterError> {
        let max_age = Self::get_staleness_window(env.clone());
        let now = env.ledger().timestamp();
        let mut prices: Vec<i128> = Vec::new(&env);
        for source in Self::sources_of(&env, &asset).iter() {
            let report: Option<SourceReport> = env
                .storage()
                .persistent()
                .get(&DataKey::SourceReport(asset.clone(), source));
            if let Some(r) = report {
                if now.saturating_sub(r.timestamp) <= max_age {
                    prices.push_back(r.price);
                }
            }
        }

        let n = prices.len();
        if n < MIN_SOURCES {
            return Err(PricingAdapterError::InsufficientSources);
        }

        let median = Self::median(&env, &prices);
        let bps = Self::get_max_deviation_bps(env.clone()) as i128;
        let mut inliers: Vec<i128> = Vec::new(&env);
        for p in prices.iter() {
            let diff = if p > median { p - median } else { median - p };
            let within = match (diff.checked_mul(10_000), median.checked_mul(bps)) {
                (Some(lhs), Some(rhs)) => lhs <= rhs,
                _ => false,
            };
            if within {
                inliers.push_back(p);
            }
        }

        if inliers.len() * 2 <= n {
            return Err(PricingAdapterError::SourcesDisagree);
        }
        Ok(Self::median(&env, &inliers))
    }

    fn sources_of(env: &Env, asset: &Address) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Sources(asset.clone()))
            .unwrap_or(Vec::new(env))
    }

    fn bump_sources_ttl(env: &Env, asset: &Address) {
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        let key = DataKey::Sources(asset.clone());
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        for source in Self::sources_of(env, asset).iter() {
            let rkey = DataKey::SourceReport(asset.clone(), source);
            if env.storage().persistent().has(&rkey) {
                env.storage()
                    .persistent()
                    .extend_ttl(&rkey, LEDGER_THRESHOLD, LEDGER_BUMP);
            }
        }
    }

    /// Median of a non-empty list (mean of the two middle values when even).
    fn median(env: &Env, values: &Vec<i128>) -> i128 {
        let mut sorted: Vec<i128> = Vec::new(env);
        for v in values.iter() {
            let mut i = sorted.len();
            while i > 0 && sorted.get_unchecked(i - 1) > v {
                i -= 1;
            }
            sorted.insert(i, v);
        }
        let k = sorted.len();
        if k % 2 == 1 {
            sorted.get_unchecked(k / 2)
        } else {
            let a = sorted.get_unchecked(k / 2 - 1);
            let b = sorted.get_unchecked(k / 2);
            a + (b - a) / 2
        }
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
}

#[cfg(test)]
mod test;
