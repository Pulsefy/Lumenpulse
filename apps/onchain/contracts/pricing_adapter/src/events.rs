use event_versioning::{versioned_event, VersionedEvent};
use soroban_sdk::{contractevent, Address, Env, Vec};

#[contractevent]
pub struct InitializedEvent {
    pub admin: Address,
}

#[contractevent]
pub struct PriceUpdatedEvent {
    #[topic]
    pub asset: Address,
    pub admin: Address,
    pub price: i128,
}

#[allow(dead_code)]
#[contractevent]
pub struct OracleUpdatedEvent {
    #[topic]
    pub asset: Address,
    pub admin: Address,
    pub oracle: Address,
}

#[contractevent]
pub struct PriceInvalidatedEvent {
    #[topic]
    pub asset: Address,
    pub admin: Address,
}

#[contractevent]
pub struct StalenessWindowUpdatedEvent {
    #[topic]
    pub admin: Address,
    pub max_age_seconds: u64,
}

// The price source events below follow the event-versioning convention
// (issue #1057): a `#[topic] pub version: u32` first field, an
// `EVENT_VERSION` constant via `versioned_event!`, and a publish helper that
// sets `version` from that constant.

/// Published when an admin replaces the ordered price source list.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceSourcesUpdatedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub admin: Address,
    pub sources: Vec<u32>,
}
versioned_event!(PriceSourcesUpdatedEvent, 1);

/// Published when an admin sets the price of a non-primary source.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourcePriceUpdatedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub asset: Address,
    #[topic]
    pub source: u32,
    pub admin: Address,
    pub price: i128,
}
versioned_event!(SourcePriceUpdatedEvent, 1);

/// Published when an admin invalidates the price of a non-primary source.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourcePriceInvalidatedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub asset: Address,
    #[topic]
    pub source: u32,
    pub admin: Address,
}
versioned_event!(SourcePriceInvalidatedEvent, 1);

/// Published when a price read skips the first source(s) of the list and
/// answers from a later one, so operators can see the primary was passed
/// over. `skipped` is the number of sources ahead of `source` in the list.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceSourceFallbackEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub asset: Address,
    pub source: u32,
    pub skipped: u32,
    pub age_seconds: u64,
}
versioned_event!(PriceSourceFallbackEvent, 1);

pub fn publish_price_sources_updated(env: &Env, admin: Address, sources: Vec<u32>) {
    PriceSourcesUpdatedEvent {
        version: PriceSourcesUpdatedEvent::EVENT_VERSION,
        admin,
        sources,
    }
    .publish(env);
}

pub fn publish_source_price_updated(
    env: &Env,
    admin: Address,
    source: u32,
    asset: Address,
    price: i128,
) {
    SourcePriceUpdatedEvent {
        version: SourcePriceUpdatedEvent::EVENT_VERSION,
        asset,
        source,
        admin,
        price,
    }
    .publish(env);
}

pub fn publish_source_price_invalidated(env: &Env, admin: Address, source: u32, asset: Address) {
    SourcePriceInvalidatedEvent {
        version: SourcePriceInvalidatedEvent::EVENT_VERSION,
        asset,
        source,
        admin,
    }
    .publish(env);
}

pub fn publish_fallback(env: &Env, asset: &Address, source: u32, skipped: u32, age_seconds: u64) {
    PriceSourceFallbackEvent {
        version: PriceSourceFallbackEvent::EVENT_VERSION,
        asset: asset.clone(),
        source,
        skipped,
        age_seconds,
    }
    .publish(env);
}
