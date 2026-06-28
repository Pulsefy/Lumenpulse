#![no_std]

mod errors;
mod events;
mod storage;

use errors::NotificationBrokerError;
use notification_interface::{Notification, NotificationReceiverClient};
use reentrancy_guard::{acquire as acquire_reentrancy, release as release_reentrancy};
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec, vec};
use storage::{DataKey, ListenerSubscription};

#[contract]
pub struct NotificationBrokerContract;

/// NotificationBroker enables cross-contract event notifications
/// Contracts can:
/// - Subscribe to events from specific sources
/// - Emit notifications to all subscribers
/// - Query their subscriptions
/// - Handle reentrancy-safe updates
///
/// Pattern:
/// 1. ContractA (source) calls notify() to emit event
/// 2. NotificationBroker routes to all subscribed ContractB, ContractC
/// 3. Each subscriber's on_notify() method is called
#[contractimpl]
impl NotificationBrokerContract {
    /// Initialize the broker with an admin
    pub fn initialize(env: Env, admin: Address) -> Result<(), NotificationBrokerError> {
        let _guard = acquire_reentrancy(&env)?;

        if env.storage().instance().has(&DataKey::Admin) {
            release_reentrancy(&env)?;
            return Err(NotificationBrokerError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().bump(100, 100);

        release_reentrancy(&env)?;

        events::InitializedEvent { admin }
            .publish(&env);

        Ok(())
    }

    /// Get the current admin
    pub fn admin(env: Env) -> Result<Address, NotificationBrokerError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(NotificationBrokerError::NotInitialized)
    }

    /// Subscribe to notifications from a source contract
    /// listener: the contract that will receive on_notify() calls
    /// source: the contract whose events to listen to
    /// event_type: optional specific event type, None means all events from source
    pub fn subscribe(
        env: Env,
        listener: Address,
        source: Address,
        event_type: Option<Symbol>,
    ) -> Result<(), NotificationBrokerError> {
        let _guard = acquire_reentrancy(&env)?;

        env.storage()
            .instance()
            .get::<_, Address>(&DataKey::Admin)
            .ok_or(NotificationBrokerError::NotInitialized)?;

        let subscription = ListenerSubscription {
            listener: listener.clone(),
            source: source.clone(),
            event_type: event_type.clone(),
            timestamp: env.ledger().timestamp(),
        };

        let key = DataKey::Subscription(
            listener.clone(),
            source.clone(),
            event_type.clone(),
        );

        env.storage().persistent().set(&key, &subscription);
        env.storage()
            .persistent()
            .bump(&key, 100, 1_000_000);

        // Add to listener's subscription list for easy enumeration
        let mut listeners_for_source: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::ListenersForSource(source.clone()))
            .unwrap_or(vec![&env]);

        if !listeners_for_source.iter().any(|l| l == &listener) {
            listeners_for_source.push_back(listener);
            env.storage()
                .persistent()
                .set(&DataKey::ListenersForSource(source), &listeners_for_source);
        }

        release_reentrancy(&env)?;

        events::SubscriptionEvent {
            listener,
            source,
            event_type,
            action: Symbol::new(&env, "subscribe"),
        }
        .publish(&env);

        Ok(())
    }

    /// Unsubscribe from notifications
    pub fn unsubscribe(
        env: Env,
        listener: Address,
        source: Address,
        event_type: Option<Symbol>,
    ) -> Result<(), NotificationBrokerError> {
        let _guard = acquire_reentrancy(&env)?;

        let key = DataKey::Subscription(listener.clone(), source.clone(), event_type.clone());

        if !env.storage().persistent().has(&key) {
            release_reentrancy(&env)?;
            return Err(NotificationBrokerError::SubscriptionNotFound);
        }

        env.storage().persistent().remove(&key);

        release_reentrancy(&env)?;

        events::SubscriptionEvent {
            listener,
            source,
            event_type,
            action: Symbol::new(&env, "unsubscribe"),
        }
        .publish(&env);

        Ok(())
    }

    /// Emit a notification from source to all subscribers
    /// This is called by contracts that want to notify others
    pub fn notify(
        env: Env,
        source: Address,
        notification: Notification,
    ) -> Result<u32, NotificationBrokerError> {
        let _guard = acquire_reentrancy(&env)?;

        env.storage()
            .instance()
            .get::<_, Address>(&DataKey::Admin)
            .ok_or(NotificationBrokerError::NotInitialized)?;

        // Verify source is the caller
        source.require_auth();

        // Get all listeners for this source
        let listeners: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::ListenersForSource(source.clone()))
            .unwrap_or(vec![&env]);

        let mut notified_count = 0u32;

        // Send notification to each listener that subscribes to this event type
        for listener in listeners.iter() {
            let event_type_key =
                DataKey::Subscription(listener.clone(), source.clone(), Some(notification.event_type.clone()));
            let any_type_key =
                DataKey::Subscription(listener.clone(), source.clone(), None);

            let subscribed_to_event = env
                .storage()
                .persistent()
                .has(&event_type_key);
            let subscribed_to_all = env
                .storage()
                .persistent()
                .has(&any_type_key);

            if subscribed_to_event || subscribed_to_all {
                // Call the listener's on_notify method
                // If this fails, we continue to notify others (best-effort delivery)
                let receiver = NotificationReceiverClient::new(&env, listener);
                let _ = receiver.on_notify(&notification);
                notified_count += 1;
            }
        }

        release_reentrancy(&env)?;

        events::NotificationEmittedEvent {
            source,
            event_type: notification.event_type,
            notified_count,
        }
        .publish(&env);

        Ok(notified_count)
    }

    /// Check if a listener is subscribed to notifications from a source
    pub fn is_subscribed(
        env: Env,
        listener: Address,
        source: Address,
        event_type: Option<Symbol>,
    ) -> Result<bool, NotificationBrokerError> {
        let key = DataKey::Subscription(listener, source, event_type);
        Ok(env.storage().persistent().has(&key))
    }

    /// Get all listeners for a source
    pub fn get_listeners_for_source(
        env: Env,
        source: Address,
    ) -> Result<Vec<Address>, NotificationBrokerError> {
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::ListenersForSource(source))
            .unwrap_or(vec![&env]))
    }
}
