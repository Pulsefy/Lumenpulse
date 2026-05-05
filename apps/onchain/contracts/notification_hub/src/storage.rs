use soroban_sdk::{contracttype, Address, Env, Symbol, Vec};

const LEDGER_THRESHOLD_SHARED: u32 = 518400; // ~30 days
const LEDGER_BUMP_SHARED: u32 = 1036800;     // ~60 days

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Subscribers(SubscriptionKey),
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct SubscriptionKey {
    pub event_type: Symbol,
    pub source: Option<Address>,
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("admin not set")
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------

pub fn get_subscribers_for_key(env: &Env, key: &SubscriptionKey) -> Vec<Address> {
    let data_key = DataKey::Subscribers(key.clone());
    env.storage()
        .persistent()
        .get(&data_key)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_subscriber(env: &Env, key: &SubscriptionKey, subscriber: &Address) {
    let data_key = DataKey::Subscribers(key.clone());
    let mut subs = get_subscribers_for_key(env, key);
    subs.push_back(subscriber.clone());
    env.storage().persistent().set(&data_key, &subs);
    env.storage()
        .persistent()
        .extend_ttl(&data_key, LEDGER_THRESHOLD_SHARED, LEDGER_BUMP_SHARED);
}

pub fn remove_subscriber(env: &Env, key: &SubscriptionKey, subscriber: &Address) {
    let data_key = DataKey::Subscribers(key.clone());
    let mut subs = get_subscribers_for_key(env, key);
    subs.retain(|s| s != *subscriber);
    if subs.is_empty() {
        env.storage().persistent().remove(&data_key);
    } else {
        env.storage().persistent().set(&data_key, &subs);
        env.storage()
            .persistent()
            .extend_ttl(&data_key, LEDGER_THRESHOLD_SHARED, LEDGER_BUMP_SHARED);
    }
}
