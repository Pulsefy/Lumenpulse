#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::Address as _,
    vec, Address, Bytes, Env,
};

use notification_interface::{Notification, NotificationReceiverTrait};

use crate::{NotificationHub, NotificationHubClient};

// ---------------------------------------------------------------------------
// Minimal mock receiver contract
// ---------------------------------------------------------------------------

#[contract]
pub struct MockReceiver;

#[contractimpl]
impl NotificationReceiverTrait for MockReceiver {
    fn on_notify(_env: Env, _notification: Notification) {
        // In a real contract this would update state; here we just accept it.
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup() -> (Env, Address, NotificationHubClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let hub_id = env.register(NotificationHub, ());
    let client = NotificationHubClient::new(&env, &hub_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    // Leak env so the client lifetime is satisfied in tests.
    let env: Env = unsafe { core::mem::transmute(env) };
    (env, admin, client)
}

fn register_receiver(env: &Env) -> Address {
    env.register(MockReceiver, ())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_initialize() {
    let (_, _, _) = setup();
    // If initialize panics the test fails; reaching here means it succeeded.
}

#[test]
#[should_panic]
fn test_double_initialize_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
}

#[test]
fn test_subscribe_and_get_subscribers() {
    let (env, admin, client) = setup();
    let event_type = symbol_short!("ST_CHNG");
    let source = Address::generate(&env);
    let subscriber = register_receiver(&env);

    client.subscribe(&admin, &event_type, &Some(source.clone()), &subscriber);

    let subs = client.get_subscribers(&event_type, &Some(source));
    assert_eq!(subs.len(), 1);
    assert_eq!(subs.get(0).unwrap(), subscriber);
}

#[test]
fn test_wildcard_subscribe() {
    let (env, admin, client) = setup();
    let event_type = symbol_short!("PRC_UPD");
    let subscriber = register_receiver(&env);

    client.subscribe(&admin, &event_type, &None, &subscriber);

    let subs = client.get_subscribers(&event_type, &None);
    assert_eq!(subs.len(), 1);
}

#[test]
#[should_panic]
fn test_duplicate_subscribe_fails() {
    let (env, admin, client) = setup();
    let event_type = symbol_short!("ST_CHNG");
    let source = Address::generate(&env);
    let subscriber = register_receiver(&env);

    client.subscribe(&admin, &event_type, &Some(source.clone()), &subscriber);
    client.subscribe(&admin, &event_type, &Some(source), &subscriber);
}

#[test]
fn test_unsubscribe() {
    let (env, admin, client) = setup();
    let event_type = symbol_short!("ST_CHNG");
    let source = Address::generate(&env);
    let subscriber = register_receiver(&env);

    client.subscribe(&admin, &event_type, &Some(source.clone()), &subscriber);
    client.unsubscribe(&admin, &event_type, &Some(source.clone()), &subscriber);

    let subs = client.get_subscribers(&event_type, &Some(source));
    assert_eq!(subs.len(), 0);
}

#[test]
#[should_panic]
fn test_unsubscribe_nonexistent_fails() {
    let (env, admin, client) = setup();
    let event_type = symbol_short!("ST_CHNG");
    let source = Address::generate(&env);
    let subscriber = register_receiver(&env);

    client.unsubscribe(&admin, &event_type, &Some(source), &subscriber);
}

#[test]
fn test_emit_fans_out_to_exact_subscribers() {
    let (env, admin, client) = setup();
    let event_type = symbol_short!("ST_CHNG");
    let source = Address::generate(&env);
    let sub1 = register_receiver(&env);
    let sub2 = register_receiver(&env);

    client.subscribe(&admin, &event_type, &Some(source.clone()), &sub1);
    client.subscribe(&admin, &event_type, &Some(source.clone()), &sub2);

    let notification = Notification {
        source: source.clone(),
        event_type: event_type.clone(),
        data: Bytes::new(&env),
    };
    // emit should not panic – fan-out to both receivers succeeds
    client.emit(&notification);
}

#[test]
fn test_emit_fans_out_to_wildcard_subscribers() {
    let (env, admin, client) = setup();
    let event_type = symbol_short!("RWD_ISS");
    let source = Address::generate(&env);
    let wildcard_sub = register_receiver(&env);

    // Subscribe with no source filter
    client.subscribe(&admin, &event_type, &None, &wildcard_sub);

    let notification = Notification {
        source: source.clone(),
        event_type: event_type.clone(),
        data: Bytes::new(&env),
    };
    client.emit(&notification);
}

#[test]
fn test_emit_fans_out_to_both_exact_and_wildcard() {
    let (env, admin, client) = setup();
    let event_type = symbol_short!("ST_CHNG");
    let source = Address::generate(&env);
    let exact_sub = register_receiver(&env);
    let wildcard_sub = register_receiver(&env);

    client.subscribe(&admin, &event_type, &Some(source.clone()), &exact_sub);
    client.subscribe(&admin, &event_type, &None, &wildcard_sub);

    let notification = Notification {
        source: source.clone(),
        event_type: event_type.clone(),
        data: Bytes::new(&env),
    };
    client.emit(&notification);

    // Both slots still have their subscriber
    assert_eq!(
        client.get_subscribers(&event_type, &Some(source)).len(),
        1
    );
    assert_eq!(client.get_subscribers(&event_type, &None).len(), 1);
}

#[test]
fn test_multiple_event_types_are_independent() {
    let (env, admin, client) = setup();
    let source = Address::generate(&env);
    let sub_a = register_receiver(&env);
    let sub_b = register_receiver(&env);

    client.subscribe(&admin, &symbol_short!("ST_CHNG"), &Some(source.clone()), &sub_a);
    client.subscribe(&admin, &symbol_short!("PRC_UPD"), &Some(source.clone()), &sub_b);

    assert_eq!(
        client.get_subscribers(&symbol_short!("ST_CHNG"), &Some(source.clone())).len(),
        1
    );
    assert_eq!(
        client.get_subscribers(&symbol_short!("PRC_UPD"), &Some(source)).len(),
        1
    );
}
