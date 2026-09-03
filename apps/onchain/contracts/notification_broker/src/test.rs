use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};

#[test]
fn test_ttl_extended_after_read_write() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let listener = Address::generate(&env);
    let source = Address::generate(&env);

    let broker_id = env.register(NotificationBrokerContract, ());
    let client = NotificationBrokerContractClient::new(&env, &broker_id);

    client.initialize(&admin);
    client.subscribe(&listener, &source, &None);

    // First threshold crossing: a read (`is_subscribed`) should re-bump both
    // the instance TTL (Admin) and the per-key persistent TTL (Subscription,
    // ListenersForSource), not just whatever TTL `subscribe` established.
    env.ledger().set_sequence_number(LEDGER_THRESHOLD + 1);
    assert!(client.is_subscribed(&listener, &source, &None));
    assert_eq!(
        client.get_listeners_for_source(&source),
        Vec::from_array(&env, [listener.clone()])
    );
    assert_eq!(client.admin(), admin);

    // Second threshold crossing: this only survives if the prior reads
    // actually extended the TTL rather than leaving it to expire.
    env.ledger().set_sequence_number(2 * LEDGER_THRESHOLD + 2);
    assert!(client.is_subscribed(&listener, &source, &None));
    assert_eq!(
        client.get_listeners_for_source(&source),
        Vec::from_array(&env, [listener])
    );
    assert_eq!(client.admin(), admin);

    // A further write after a long gap must also succeed and keep
    // protecting subsequent reads.
    let listener_2 = Address::generate(&env);
    client.subscribe(&listener_2, &source, &None);
    env.ledger().set_sequence_number(3 * LEDGER_THRESHOLD + 3);
    assert!(client.is_subscribed(&listener_2, &source, &None));
}
