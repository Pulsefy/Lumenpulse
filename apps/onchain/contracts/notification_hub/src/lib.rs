#![no_std]

mod storage;
mod events;

#[cfg(test)]
mod test;

use notification_interface::{
    Notification, NotificationError, NotificationHubTrait, NotificationReceiverClient,
};
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};

use storage::{
    add_subscriber, get_admin, has_admin, remove_subscriber, set_admin,
    get_subscribers_for_key, SubscriptionKey,
};
use events::{NotificationEmittedEvent, SubscriberAddedEvent, SubscriberRemovedEvent};

/// Maximum subscribers per (event_type, source) slot to bound fan-out cost.
const MAX_SUBSCRIBERS: u32 = 50;

#[contract]
pub struct NotificationHub;

#[contractimpl]
impl NotificationHubTrait for NotificationHub {
    fn initialize(env: Env, admin: Address) {
        if has_admin(&env) {
            panic!("{}", NotificationError::AlreadyInitialized as u32);
        }
        set_admin(&env, &admin);
    }

    fn subscribe(
        env: Env,
        caller: Address,
        event_type: Symbol,
        source: Option<Address>,
        subscriber: Address,
    ) {
        // Only the admin or the subscriber itself may register a subscription.
        let admin = get_admin(&env);
        if caller != admin && caller != subscriber {
            panic!("{}", NotificationError::Unauthorized as u32);
        }
        caller.require_auth();

        let key = SubscriptionKey { event_type: event_type.clone(), source: source.clone() };
        let subs = get_subscribers_for_key(&env, &key);

        if subs.contains(&subscriber) {
            panic!("{}", NotificationError::SubscriberAlreadyRegistered as u32);
        }
        if subs.len() >= MAX_SUBSCRIBERS {
            panic!("{}", NotificationError::TooManySubscribers as u32);
        }

        add_subscriber(&env, &key, &subscriber);

        SubscriberAddedEvent {
            event_type,
            source,
            subscriber,
        }
        .publish(&env);
    }

    fn unsubscribe(
        env: Env,
        caller: Address,
        event_type: Symbol,
        source: Option<Address>,
        subscriber: Address,
    ) {
        let admin = get_admin(&env);
        if caller != admin && caller != subscriber {
            panic!("{}", NotificationError::Unauthorized as u32);
        }
        caller.require_auth();

        let key = SubscriptionKey { event_type: event_type.clone(), source: source.clone() };
        let subs = get_subscribers_for_key(&env, &key);

        if !subs.contains(&subscriber) {
            panic!("{}", NotificationError::SubscriberNotFound as u32);
        }

        remove_subscriber(&env, &key, &subscriber);

        SubscriberRemovedEvent {
            event_type,
            source,
            subscriber,
        }
        .publish(&env);
    }

    fn emit(env: Env, notification: Notification) {
        // The source contract must authorise the emission.
        notification.source.require_auth();

        // Fan out to exact-match subscribers (source-specific).
        let exact_key = SubscriptionKey {
            event_type: notification.event_type.clone(),
            source: Some(notification.source.clone()),
        };
        dispatch(&env, &exact_key, &notification);

        // Fan out to wildcard subscribers (any-source).
        let wildcard_key = SubscriptionKey {
            event_type: notification.event_type.clone(),
            source: None,
        };
        dispatch(&env, &wildcard_key, &notification);

        NotificationEmittedEvent {
            source: notification.source.clone(),
            event_type: notification.event_type.clone(),
        }
        .publish(&env);
    }

    fn get_subscribers(
        env: Env,
        event_type: Symbol,
        source: Option<Address>,
    ) -> Vec<Address> {
        let key = SubscriptionKey { event_type, source };
        get_subscribers_for_key(&env, &key)
    }
}

/// Call `on_notify` on every subscriber registered under `key`.
fn dispatch(env: &Env, key: &SubscriptionKey, notification: &Notification) {
    let subs = get_subscribers_for_key(env, key);
    for subscriber in subs.iter() {
        let client = NotificationReceiverClient::new(env, &subscriber);
        client.on_notify(notification);
    }
}
