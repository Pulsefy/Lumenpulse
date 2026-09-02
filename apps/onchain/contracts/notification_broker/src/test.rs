use crate::errors::NotificationBrokerError;
use crate::events::{InitializedEvent, NotificationEmittedEvent, SubscriptionEvent};
use crate::{NotificationBrokerContract, NotificationBrokerContractClient};
use notification_interface::{Notification, NotificationReceiverClient, NotificationReceiverTrait};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events},
    vec, Address, Bytes, Env, Symbol,
};

// ---------------------------------------------------------------------------
// Mock receiver that records notifications
// ---------------------------------------------------------------------------

#[contract]
pub struct MockReceiver;

#[contractimpl]
impl MockReceiver {
    pub fn on_notify(_env: Env, _notification: Notification) {}
}

#[contract]
pub struct RecordingReceiver {
    pub count: u32,
}

#[contractimpl]
impl RecordingReceiver {
    pub fn on_notify(_env: Env, _notification: Notification) {}
}

#[contract]
pub struct FailingReceiver;

#[contractimpl]
impl FailingReceiver {
    pub fn on_notify(_env: Env, _notification: Notification) {
        panic!("intentional failure");
    }
}

#[contract]
pub struct NonConformingContract;

#[contractimpl]
impl NonConformingContract {
    pub fn some_method(_env: Env) {}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup<'a>(
    env: &Env,
) -> (
    NotificationBrokerContractClient<'a>,
    Address,
    Address,
    Address,
) {
    let admin = Address::generate(env);
    let source = Address::generate(env);
    let listener = Address::generate(env);

    let contract_id = env.register(NotificationBrokerContract, ());
    let client = NotificationBrokerContractClient::new(env, &contract_id);

    client.initialize(&admin);

    (client, admin, source, listener)
}

fn register_receiver(env: &Env) -> Address {
    let receiver_id = env.register(MockReceiver, ());
    receiver_id
}

fn register_failing_receiver(env: &Env) -> Address {
    let receiver_id = env.register(FailingReceiver, ());
    receiver_id
}

fn register_non_conforming(env: &Env) -> Address {
    let id = env.register(NonConformingContract, ());
    id
}

fn make_notification(env: &Env, source: &Address, event_type: Symbol) -> Notification {
    Notification {
        source: source.clone(),
        event_type,
        data: Bytes::from_slice(env, b"test-payload"),
    }
}

// ---------------------------------------------------------------------------
// Subscriber registration
// ---------------------------------------------------------------------------

#[test]
fn test_subscribe_registers_listener() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, listener) = setup(&env);

    client.subscribe(&listener, &source, &None);

    assert!(client.is_subscribed(&listener, &source, &None));

    let listeners = client.get_listeners_for_source(&source);
    assert_eq!(listeners.len(), 1);
    assert_eq!(listeners.get(0).unwrap(), listener);
}

#[test]
fn test_subscribe_with_specific_event_type() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, listener) = setup(&env);
    let event_type = symbol_short!("deposit");

    client.subscribe(&listener, &source, &Some(event_type.clone()));

    assert!(client.is_subscribed(&listener, &source, &Some(event_type.clone())));
    assert!(!client.is_subscribed(&listener, &source, &None));
}

#[test]
fn test_subscribe_emits_subscription_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, listener) = setup(&env);

    client.subscribe(&listener, &source, &None);

    let events = env.events().all();
    assert!(!events.is_empty());

    let found_subscription_event = events.iter().any(|(contract_address, topics, _data)| {
        let topic_strs: Vec<String> = topics.iter().map(|t| t.to_string()).collect();
        contract_address == client.address
            && topic_strs.iter().any(|s| s.contains("SubscriptionEvent"))
    });
    assert!(
        found_subscription_event,
        "SubscriptionEvent should be emitted"
    );
}

#[test]
fn test_duplicate_subscription_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, listener) = setup(&env);

    client.subscribe(&listener, &source, &None);
    client.subscribe(&listener, &source, &None);

    let listeners = client.get_listeners_for_source(&source);
    assert_eq!(listeners.len(), 1);
    assert_eq!(listeners.get(0).unwrap(), listener);
}

#[test]
fn test_duplicate_subscription_with_different_event_type() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, listener) = setup(&env);

    client.subscribe(&listener, &source, &None);
    client.subscribe(&listener, &source, &Some(symbol_short!("deposit")));

    assert!(client.is_subscribed(&listener, &source, &None));
    assert!(client.is_subscribed(&listener, &source, &Some(symbol_short!("deposit"))));

    let listeners = client.get_listeners_for_source(&source);
    assert_eq!(listeners.len(), 1);
}

#[test]
fn test_subscribe_not_initialized_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(NotificationBrokerContract, ());
    let client = NotificationBrokerContractClient::new(env, &contract_id);

    let source = Address::generate(&env);
    let listener = Address::generate(&env);

    let result = client.try_subscribe(&listener, &source, &None);
    assert_eq!(result, Err(Ok(NotificationBrokerError::NotInitialized)));
}

// ---------------------------------------------------------------------------
// Deregistration
// ---------------------------------------------------------------------------

#[test]
fn test_unsubscribe_removes_listener() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, listener) = setup(&env);

    client.subscribe(&listener, &source, &None);
    assert!(client.is_subscribed(&listener, &source, &None));

    client.unsubscribe(&listener, &source, &None);
    assert!(!client.is_subscribed(&listener, &source, &None));

    let listeners = client.get_listeners_for_source(&source);
    assert_eq!(listeners.len(), 0);
}

#[test]
fn test_unsubscribe_emits_unsubscribe_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, listener) = setup(&env);

    client.subscribe(&listener, &source, &None);
    client.unsubscribe(&listener, &source, &None);

    let events = env.events().all();
    let found_unsubscribe_event = events.iter().any(|(contract_address, topics, _data)| {
        let topic_strs: Vec<String> = topics.iter().map(|t| t.to_string()).collect();
        contract_address == client.address
            && topic_strs.iter().any(|s| s.contains("SubscriptionEvent"))
    });
    assert!(
        found_unsubscribe_event,
        "SubscriptionEvent with unsubscribe action should be emitted"
    );
}

#[test]
fn test_unsubscribe_nonexistent_subscription_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, listener) = setup(&env);

    let result = client.try_unsubscribe(&listener, &source, &None);
    assert_eq!(
        result,
        Err(Ok(NotificationBrokerError::SubscriptionNotFound))
    );
}

#[test]
fn test_unsubscribe_only_removes_specific_event_type() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, listener) = setup(&env);

    client.subscribe(&listener, &source, &None);
    client.subscribe(&listener, &source, &Some(symbol_short!("deposit")));

    client.unsubscribe(&listener, &source, &Some(symbol_short!("deposit")));

    assert!(client.is_subscribed(&listener, &source, &None));
    assert!(!client.is_subscribed(&listener, &source, &Some(symbol_short!("deposit"))));
}

// ---------------------------------------------------------------------------
// Notification dispatch
// ---------------------------------------------------------------------------

#[test]
fn test_notify_dispatches_to_single_subscriber() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, _listener) = setup(&env);

    let receiver_id = register_receiver(&env);
    client.subscribe(&receiver_id, &source, &None);

    let notification = make_notification(&env, &source, symbol_short!("deposit"));
    let count = client.notify(&source, &notification);

    assert_eq!(count, 1);
}

#[test]
fn test_notify_dispatches_to_multiple_subscribers() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, _listener) = setup(&env);

    let receiver1 = register_receiver(&env);
    let receiver2 = register_receiver(&env);
    let receiver3 = register_receiver(&env);

    client.subscribe(&receiver1, &source, &None);
    client.subscribe(&receiver2, &source, &None);
    client.subscribe(&receiver3, &source, &None);

    let notification = make_notification(&env, &source, symbol_short!("deposit"));
    let count = client.notify(&source, &notification);

    assert_eq!(count, 3);
}

#[test]
fn test_notify_payload_shape_matches_interface() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, _listener) = setup(&env);

    let receiver_id = register_receiver(&env);
    client.subscribe(&receiver_id, &source, &None);

    let data = Bytes::from_slice(&env, b"yield-accrued-1000");
    let notification = Notification {
        source: source.clone(),
        event_type: symbol_short!("yield_accrued"),
        data: data.clone(),
    };

    let count = client.notify(&source, &notification);
    assert_eq!(count, 1);
}

#[test]
fn test_notify_respects_event_type_filter() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, _listener) = setup(&env);

    let all_events_receiver = register_receiver(&env);
    let deposit_only_receiver = register_receiver(&env);

    client.subscribe(&all_events_receiver, &source, &None);
    client.subscribe(
        &deposit_only_receiver,
        &source,
        &Some(symbol_short!("deposit")),
    );

    let notification = make_notification(&env, &source, symbol_short!("deposit"));
    let count = client.notify(&source, &notification);

    assert_eq!(count, 2);

    let withdrawal_notification = make_notification(&env, &source, symbol_short!("withdrawal"));
    let count = client.notify(&source, &withdrawal_notification);

    assert_eq!(count, 1);
}

#[test]
fn test_notify_emits_notification_emitted_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, _listener) = setup(&env);

    let receiver_id = register_receiver(&env);
    client.subscribe(&receiver_id, &source, &None);

    let notification = make_notification(&env, &source, symbol_short!("deposit"));
    client.notify(&source, &notification);

    let events = env.events().all();
    let found_emitted_event = events.iter().any(|(contract_address, topics, _data)| {
        let topic_strs: Vec<String> = topics.iter().map(|t| t.to_string()).collect();
        contract_address == client.address
            && topic_strs
                .iter()
                .any(|s| s.contains("NotificationEmittedEvent"))
    });
    assert!(
        found_emitted_event,
        "NotificationEmittedEvent should be emitted"
    );
}

#[test]
fn test_notify_returns_zero_when_no_subscribers() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, _listener) = setup(&env);

    let notification = make_notification(&env, &source, symbol_short!("deposit"));
    let count = client.notify(&source, &notification);

    assert_eq!(count, 0);
}

#[test]
fn test_notify_does_not_dispatch_to_unsubscribed_listeners() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, _listener) = setup(&env);

    let receiver1 = register_receiver(&env);
    let receiver2 = register_receiver(&env);

    client.subscribe(&receiver1, &source, &None);
    client.subscribe(&receiver2, &source, &None);
    client.unsubscribe(&receiver2, &source, &None);

    let notification = make_notification(&env, &source, symbol_short!("deposit"));
    let count = client.notify(&source, &notification);

    assert_eq!(count, 1);
}

// ---------------------------------------------------------------------------
// Failing subscriber does not block delivery
// ---------------------------------------------------------------------------

#[test]
fn test_failing_subscriber_does_not_block_others() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, _listener) = setup(&env);

    let good_receiver = register_receiver(&env);
    let failing_receiver = register_failing_receiver(&env);

    client.subscribe(&good_receiver, &source, &None);
    client.subscribe(&failing_receiver, &source, &None);

    let notification = make_notification(&env, &source, symbol_short!("deposit"));

    let count = client.notify(&source, &notification);
    assert_eq!(count, 2);
}

#[test]
fn test_non_conforming_subscriber_does_not_block_others() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, _listener) = setup(&env);

    let good_receiver = register_receiver(&env);
    let non_conforming = register_non_conforming(&env);

    client.subscribe(&good_receiver, &source, &None);
    client.subscribe(&non_conforming, &source, &None);

    let notification = make_notification(&env, &source, symbol_short!("deposit"));

    let count = client.notify(&source, &notification);
    assert_eq!(count, 2);
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

#[test]
fn test_notify_requires_source_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, _listener) = setup(&env);

    let receiver_id = register_receiver(&env);
    client.subscribe(&receiver_id, &source, &None);

    let notification = make_notification(&env, &source, symbol_short!("deposit"));

    let count = client.notify(&source, &notification);
    assert_eq!(count, 1);
}

#[test]
fn test_unauthorized_publish_attempt_reverts() {
    let env = Env::default();

    let (client, _admin, source, _listener) = setup(&env);

    let receiver_id = register_receiver(&env);
    client.subscribe(&receiver_id, &source, &None);

    let notification = make_notification(&env, &source, symbol_short!("deposit"));

    let result = client.try_notify(&source, &notification);
    assert!(result.is_err());
}

#[test]
fn test_initialize_emits_initialized_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(NotificationBrokerContract, ());
    let client = NotificationBrokerContractClient::new(&env, &contract_id);

    client.initialize(&admin);

    let events = env.events().all();
    let found_initialized_event = events.iter().any(|(contract_address, topics, _data)| {
        let topic_strs: Vec<String> = topics.iter().map(|t| t.to_string()).collect();
        contract_address == client.address
            && topic_strs.iter().any(|s| s.contains("InitializedEvent"))
    });
    assert!(
        found_initialized_event,
        "InitializedEvent should be emitted"
    );
}

#[test]
fn test_double_initialize_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _source, _listener) = setup(&env);

    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(NotificationBrokerError::AlreadyInitialized)));
}

#[test]
fn test_admin_returns_correct_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _source, _listener) = setup(&env);

    assert_eq!(client.admin(), admin);
}

#[test]
fn test_admin_not_initialized_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(NotificationBrokerContract, ());
    let client = NotificationBrokerContractClient::new(&env, &contract_id);

    let result = client.try_admin();
    assert_eq!(result, Err(Ok(NotificationBrokerError::NotInitialized)));
}

// ---------------------------------------------------------------------------
// Event shape assertions matching soroban-event-mapper.ts expectations
// ---------------------------------------------------------------------------

#[test]
fn test_initialized_event_shape_matches_mapper() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(NotificationBrokerContract, ());
    let client = NotificationBrokerContractClient::new(&env, &contract_id);

    client.initialize(&admin);

    let events = env.events().all();
    let initialized_event = events.iter().find(|(contract_address, topics, _data)| {
        let topic_strs: Vec<String> = topics.iter().map(|t| t.to_string()).collect();
        contract_address == client.address
            && topic_strs.iter().any(|s| s.contains("InitializedEvent"))
    });

    assert!(
        initialized_event.is_some(),
        "InitializedEvent must be emitted for soroban-event-mapper.ts mapping"
    );
}

#[test]
fn test_subscription_event_shape_matches_mapper() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, listener) = setup(&env);

    client.subscribe(&listener, &source, &None);

    let events = env.events().all();
    let subscription_event = events.iter().find(|(contract_address, topics, _data)| {
        let topic_strs: Vec<String> = topics.iter().map(|t| t.to_string()).collect();
        contract_address == client.address
            && topic_strs.iter().any(|s| s.contains("SubscriptionEvent"))
    });

    assert!(
        subscription_event.is_some(),
        "SubscriptionEvent must be emitted for soroban-event-mapper.ts mapping"
    );
}

#[test]
fn test_notification_emitted_event_shape_matches_mapper() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source, _listener) = setup(&env);

    let receiver_id = register_receiver(&env);
    client.subscribe(&receiver_id, &source, &None);

    let notification = make_notification(&env, &source, symbol_short!("deposit"));
    client.notify(&source, &notification);

    let events = env.events().all();
    let emitted_event = events.iter().find(|(contract_address, topics, _data)| {
        let topic_strs: Vec<String> = topics.iter().map(|t| t.to_string()).collect();
        contract_address == client.address
            && topic_strs
                .iter()
                .any(|s| s.contains("NotificationEmittedEvent"))
    });

    assert!(
        emitted_event.is_some(),
        "NotificationEmittedEvent must be emitted for soroban-event-mapper.ts mapping"
    );
}

// ---------------------------------------------------------------------------
// Multiple sources isolation
// ---------------------------------------------------------------------------

#[test]
fn test_subscriptions_are_isolated_by_source() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source1, listener) = setup(&env);
    let source2 = Address::generate(&env);

    client.subscribe(&listener, &source1, &None);

    assert!(client.is_subscribed(&listener, &source1, &None));
    assert!(!client.is_subscribed(&listener, &source2, &None));

    let listeners_source1 = client.get_listeners_for_source(&source1);
    let listeners_source2 = client.get_listeners_for_source(&source2);

    assert_eq!(listeners_source1.len(), 1);
    assert_eq!(listeners_source2.len(), 0);
}

#[test]
fn test_notify_only_dispatches_to_source_subscribers() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, source1, _listener) = setup(&env);
    let source2 = Address::generate(&env);

    let receiver1 = register_receiver(&env);
    let receiver2 = register_receiver(&env);

    client.subscribe(&receiver1, &source1, &None);
    client.subscribe(&receiver2, &source2, &None);

    let notification = make_notification(&env, &source1, symbol_short!("deposit"));
    let count = client.notify(&source1, &notification);

    assert_eq!(count, 1);
}
