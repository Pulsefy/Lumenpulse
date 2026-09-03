#![no_std]

//! Shared notification contract surface.
//!
//! This crate defines the `NotificationReceiverTrait` interface that any contract
//! can implement to receive notifications dispatched by the `notification_broker`
//! (and other notifiers such as `crowdfund_vault`).
//!
//! # Implementing contracts
//!
//! The following contracts in this workspace declare that they implement
//! `NotificationReceiverTrait` and are covered by the conformance suite:
//!
//! - `contributor_registry` (`ContributorRegistryContract`)
//!
//! Because implementers use `impl NotificationReceiverTrait`, adding a method to
//! the trait without updating every implementer is a compile error. The
//! conformance tests (in this crate's `conformance` module and in each
//! implementer's own test suite) also exercise each implementer end to end to
//! catch signature drift.

use soroban_sdk::{contractclient, contracttype, Address, Bytes, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Notification {
    pub source: Address,
    pub event_type: Symbol,
    pub data: Bytes,
}

#[contractclient(name = "NotificationReceiverClient")]
pub trait NotificationReceiverTrait {
    fn on_notify(env: Env, notification: Notification);
}

#[cfg(test)]
pub mod conformance {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl, testutils::Address as _, Address, Bytes, Env, Symbol,
    };

    /// A mock receiver used by the conformance suite. It records every
    /// notification it receives keyed by the notification's source address.
    #[derive(Clone)]
    #[contract]
    pub struct MockNotificationReceiver;

    #[contractimpl]
    impl NotificationReceiverTrait for MockNotificationReceiver {
        fn on_notify(env: Env, notification: Notification) {
            let key = notification.source.clone();
            env.storage().instance().set(&key, &notification);
        }
    }

    /// Exercises a registered receiver through the interface's generated client.
    ///
    /// This both asserts that the contract exposes the `on_notify` entry point
    /// with the exact signature declared by [`NotificationReceiverTrait`] and
    /// returns the notification that was delivered so callers can assert on the
    /// receiver's side effects.
    pub fn assert_receiver_signature(env: &Env, id: &Address, notification: &Notification) {
        let client = NotificationReceiverClient::new(env, id);
        client.on_notify(notification);
    }

    /// Builds a [`Notification`] for use in tests.
    pub fn sample_notification(env: &Env, source: &Address, event_type: &str) -> Notification {
        Notification {
            source: source.clone(),
            event_type: Symbol::new(env, event_type),
            data: Bytes::new(env),
        }
    }

    #[test]
    fn mock_receiver_implements_interface_end_to_end() {
        let env = Env::default();
        env.mock_all_auths();

        let id = env.register(MockNotificationReceiver, ());
        let source = Address::generate(&env);
        let notification = sample_notification(&env, &source, "test");

        assert_receiver_signature(&env, &id, &notification);

        let stored: Notification =
            env.as_contract(&id, || env.storage().instance().get(&source).unwrap());
        assert_eq!(stored, notification);
    }
}
