#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Events, Ledger};
use soroban_sdk::{Address, Bytes, Env, IntoVal, Symbol, Vec};

fn create_timelock_contract(env: &Env) -> Address {
    env.register(
        crate::TimelockContract,
        (),
    )
}

fn initialize_timelock(
    env: &Env,
    contract: &Address,
    admin: &Address,
    min_delay: u64,
    max_delay: u64,
) {
    client::TimelockClient::new(env, contract).initialize(admin, min_delay, max_delay);
}

mod client {
    use soroban_sdk::{contractclient, Address, Bytes, BytesN, Env, Symbol, Vec};

    #[contractclient(name = "TimelockClient")]
    pub trait Timelock {
        fn initialize(admin: &Address, min_delay: u64, max_delay: u64);
        fn queue_action(
            proposer: &Address,
            action_type: &Symbol,
            target_contract: &Address,
            payload: &Bytes,
            delay: u64,
        ) -> BytesN<32>;
        fn execute_proposal(proposal_id: &BytesN<32>);
        fn cancel_proposal(caller: &Address, proposal_id: &BytesN<32>);
        fn get_proposal(proposal_id: &BytesN<32>) -> crate::storage::TimelockProposal;
        fn has_proposal(proposal_id: &BytesN<32>) -> bool;
        fn get_config() -> crate::storage::TimelockConfig;
        fn get_admin() -> Address;
        fn is_executable(proposal_id: &BytesN<32>) -> bool;
        fn update_config(admin: &Address, min_delay: u64, max_delay: u64);
        fn set_admin(current_admin: &Address, new_admin: &Address);
    }
}

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract = create_timelock_contract(&env);
    let admin = Address::generate(&env);

    initialize_timelock(&env, &contract, &admin, 86400, 604800);

    let config = client::TimelockClient::new(&env, &contract).get_config();
    assert_eq!(config.min_delay, 86400);
    assert_eq!(config.max_delay, 604800);

    let stored_admin = client::TimelockClient::new(&env, &contract).get_admin();
    assert_eq!(stored_admin, admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #100)")]
fn test_initialize_twice_fails() {
    let env = Env::default();
    let contract = create_timelock_contract(&env);
    let admin = Address::generate(&env);

    initialize_timelock(&env, &contract, &admin, 86400, 604800);
    initialize_timelock(&env, &contract, &admin, 86400, 604800);
}

#[test]
#[should_panic(expected = "Error(Contract, #103)")]
fn test_initialize_invalid_delay() {
    let env = Env::default();
    let contract = create_timelock_contract(&env);
    let admin = Address::generate(&env);

    // min_delay cannot be 0
    initialize_timelock(&env, &contract, &admin, 0, 604800);
}

#[test]
fn test_queue_action() {
    let env = Env::default();
    let contract = create_timelock_contract(&env);
    let admin = Address::generate(&env);

    initialize_timelock(&env, &contract, &admin, 86400, 604800);

    let target = Address::generate(&env);
    let action_type = Symbol::new(&env, "pause");
    let payload = Bytes::new(&env);

    env.mock_all_auths();

    let proposal_id = client::TimelockClient::new(&env, &contract).queue_action(
        &admin,
        &action_type,
        &target,
        &payload,
        86400,
    );

    // Verify proposal was created
    assert!(client::TimelockClient::new(&env, &contract).has_proposal(&proposal_id));

    let proposal = client::TimelockClient::new(&env, &contract).get_proposal(&proposal_id);
    assert_eq!(proposal.proposer, admin);
    assert_eq!(proposal.action_type, action_type);
    assert_eq!(proposal.target_contract, target);
    assert!(!proposal.executed);
    assert!(!proposal.cancelled);
}

#[test]
#[should_panic(expected = "Error(Contract, #104)")]
fn test_queue_action_delay_too_short() {
    let env = Env::default();
    let contract = create_timelock_contract(&env);
    let admin = Address::generate(&env);

    initialize_timelock(&env, &contract, &admin, 86400, 604800);

    let target = Address::generate(&env);
    let action_type = Symbol::new(&env, "pause");
    let payload = Bytes::new(&env);

    env.mock_all_auths();

    // Delay shorter than min_delay
    client::TimelockClient::new(&env, &contract).queue_action(
        &admin,
        &action_type,
        &target,
        &payload,
        3600, // 1 hour, but min is 24 hours
    );
}

#[test]
fn test_execute_proposal_after_delay() {
    let env = Env::default();
    let contract = create_timelock_contract(&env);
    let admin = Address::generate(&env);

    initialize_timelock(&env, &contract, &admin, 86400, 604800);

    // Note: This test demonstrates the concept but actual execution
    // would require a real target contract that implements the action
    let target = Address::generate(&env);
    let action_type = Symbol::new(&env, "pause");
    let payload = Bytes::new(&env);

    env.mock_all_auths();

    let proposal_id = client::TimelockClient::new(&env, &contract).queue_action(
        &admin,
        &action_type,
        &target,
        &payload,
        86400,
    );

    // Verify not executable yet
    assert!(!client::TimelockClient::new(&env, &contract).is_executable(&proposal_id));

    // Advance time past the delay
    env.ledger().with_mut(|l| {
        l.timestamp += 86401; // 24 hours + 1 second
    });

    // Now should be executable
    assert!(client::TimelockClient::new(&env, &contract).is_executable(&proposal_id));
}

#[test]
fn test_cancel_proposal() {
    let env = Env::default();
    let contract = create_timelock_contract(&env);
    let admin = Address::generate(&env);

    initialize_timelock(&env, &contract, &admin, 86400, 604800);

    let target = Address::generate(&env);
    let action_type = Symbol::new(&env, "pause");
    let payload = Bytes::new(&env);

    env.mock_all_auths();

    let proposal_id = client::TimelockClient::new(&env, &contract).queue_action(
        &admin,
        &action_type,
        &target,
        &payload,
        86400,
    );

    // Cancel the proposal
    client::TimelockClient::new(&env, &contract).cancel_proposal(&admin, &proposal_id);

    // Verify proposal is cancelled
    let proposal = client::TimelockClient::new(&env, &contract).get_proposal(&proposal_id);
    assert!(proposal.cancelled);
    assert!(!proposal.executed);
}

#[test]
fn test_events_emitted() {
    let env = Env::default();
    let contract = create_timelock_contract(&env);
    let admin = Address::generate(&env);

    env.mock_all_auths();

    initialize_timelock(&env, &contract, &admin, 86400, 604800);

    // Check initialization event
    let events = env.events().all();
    assert!(events.len() > 0);
}
