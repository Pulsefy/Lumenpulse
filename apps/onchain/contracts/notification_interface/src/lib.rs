#![no_std]

use soroban_sdk::{contractclient, contracttype, contracterror, Address, Bytes, Env, Symbol};

// ---------------------------------------------------------------------------
// Core notification payload
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Notification {
    pub source: Address,
    pub event_type: Symbol,
    pub data: Bytes,
}

// ---------------------------------------------------------------------------
// Well-known event-type symbols (helpers for callers)
// ---------------------------------------------------------------------------

/// Canonical event types used across LumenPulse contracts.
pub mod event_types {
    use soroban_sdk::{symbol_short, Symbol};

    pub fn state_changed() -> Symbol { symbol_short!("ST_CHNG") }
    pub fn price_updated() -> Symbol { symbol_short!("PRC_UPD") }
    pub fn reward_issued() -> Symbol { symbol_short!("RWD_ISS") }
    pub fn subscription_changed() -> Symbol { symbol_short!("SUB_CHG") }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum NotificationError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    SubscriberAlreadyRegistered = 4,
    SubscriberNotFound = 5,
    TooManySubscribers = 6,
}

// ---------------------------------------------------------------------------
// Receiver trait – implemented by any contract that wants to receive events
// ---------------------------------------------------------------------------

#[contractclient(name = "NotificationReceiverClient")]
pub trait NotificationReceiverTrait {
    fn on_notify(env: Env, notification: Notification);
}

// ---------------------------------------------------------------------------
// Hub trait – implemented by the notification_hub contract
// ---------------------------------------------------------------------------

#[contractclient(name = "NotificationHubClient")]
pub trait NotificationHubTrait {
    /// One-time initialisation; sets the admin address.
    fn initialize(env: Env, admin: Address);

    /// Register `subscriber` to receive events of `event_type` from `source`.
    /// Pass `None` for `source` to subscribe to that event type from any source.
    fn subscribe(
        env: Env,
        caller: Address,
        event_type: Symbol,
        source: Option<Address>,
        subscriber: Address,
    );

    /// Remove a previously registered subscription.
    fn unsubscribe(
        env: Env,
        caller: Address,
        event_type: Symbol,
        source: Option<Address>,
        subscriber: Address,
    );

    /// Emit a notification; the hub fans it out to all matching subscribers.
    /// Only the `source` address itself may call this (it must auth).
    fn emit(env: Env, notification: Notification);

    /// Return all subscribers for a given (event_type, source) pair.
    /// Pass `None` for `source` to query wildcard subscriptions.
    fn get_subscribers(
        env: Env,
        event_type: Symbol,
        source: Option<Address>,
    ) -> soroban_sdk::Vec<Address>;
}
