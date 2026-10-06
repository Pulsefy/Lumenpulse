extern crate std;

use crate::{NotificationBrokerContract, NotificationBrokerContractClient};
use notification_interface::{Notification, NotificationReceiverTrait};
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Bytes, Env, Symbol};

#[contract]
struct BenchmarkReceiver;

#[contractimpl]
impl NotificationReceiverTrait for BenchmarkReceiver {
    fn on_notify(_env: Env, _notification: Notification) {}
}

fn record(env: &Env, entrypoint: &str) {
    let cost = env.cost_estimate().resources();
    std::println!(
        "SOROBAN_COST_BENCHMARK {{\"contract\":\"notification_broker\",\"entrypoint\":\"{entrypoint}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}",
        cost.instructions,
        cost.memory_read_entries + cost.disk_read_entries,
        cost.write_entries,
    );
}

#[test]
fn successful_entrypoint_costs() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let source = Address::generate(&env);
    let listener = env.register(BenchmarkReceiver, ());
    let id = env.register(NotificationBrokerContract, ());
    let client = NotificationBrokerContractClient::new(&env, &id);
    let event_type = Symbol::new(&env, "payment");

    client.initialize(&admin);
    record(&env, "initialize");
    let _ = client.admin();
    record(&env, "admin");
    client.subscribe(&listener, &source, &Some(event_type.clone()));
    record(&env, "subscribe");
    let notification = Notification {
        source: source.clone(),
        event_type: event_type.clone(),
        data: Bytes::from_slice(&env, b"payment-settled"),
    };
    let _ = client.notify(&source, &notification);
    record(&env, "notify");
    let _ = client.is_subscribed(&listener, &source, &Some(event_type.clone()));
    record(&env, "is_subscribed");
    let _ = client.get_listeners_for_source(&source);
    record(&env, "get_listeners_for_source");
    client.unsubscribe(&listener, &source, &Some(event_type));
    record(&env, "unsubscribe");
}
