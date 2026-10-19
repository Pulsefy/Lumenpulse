//! Golden payload fixtures for lumenpulse-curation's event-versioned events
//! (issue #1623). See `contracts/event-golden/README.md` for the format and
//! the change workflow.

use soroban_sdk::{contract, contractimpl, testutils::Events, Address, Env, String};

use crate::events::*;
use crate::ProjectMetadata;

// Deterministic, valid StrKey account addresses (fixed 32-byte seeds), so the
// fixtures never depend on `Address::generate`'s thread RNG.
const ACCOUNTS: [&str; 3] = [
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H",
    "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA",
];

fn addr(env: &Env, i: usize) -> Address {
    Address::from_string(&String::from_str(env, ACCOUNTS[i]))
}

#[contract]
pub struct GoldenHarness;

#[contractimpl]
impl GoldenHarness {
    pub fn emit(env: Env, case: u32) {
        match case {
            0 => {
                let metadata = ProjectMetadata {
                    name: String::from_str(&env, "Lumen Grid"),
                    description: String::from_str(&env, "Decentralised solar micro-grid"),
                    url: String::from_str(&env, "https://lumen.example/grid"),
                    funding_address: addr(&env, 2),
                };
                emit_project_proposed(&env, 42, &addr(&env, 1), &metadata);
            }
            1 => emit_vote_cast(&env, 42, &addr(&env, 1), true, 1_500),
            2 => emit_project_verified(&env, 42),
            3 => emit_project_rejected(&env, 42),
            4 => emit_proposal_expired(&env, 42),
            other => panic!("unknown golden event case {other}"),
        }
    }
}

fn capture(case: u32) -> (Env, soroban_sdk::Vec<soroban_sdk::Val>, soroban_sdk::Val) {
    let env = Env::default();
    let id = env.register(GoldenHarness, ());
    let client = GoldenHarnessClient::new(&env, &id);
    client.emit(&case);
    let events = env.events().all();
    assert_eq!(events.len(), 1, "case {case} should emit exactly one event");
    let (_emitter, topics, data) = events.get(0).unwrap();
    (env, topics, data)
}

macro_rules! golden_case {
    ($name:ident, $case:expr, $event:literal) => {
        #[test]
        fn $name() {
            let (env, topics, data) = capture($case);
            event_golden::assert_golden(&env, "lumenpulse-curation", $event, 1, &topics, &data);
        }
    };
}

golden_case!(golden_project_proposed_event, 0, "project_proposed_event");
golden_case!(golden_vote_cast_event, 1, "vote_cast_event");
golden_case!(golden_project_verified_event, 2, "project_verified_event");
golden_case!(golden_project_rejected_event, 3, "project_rejected_event");
golden_case!(golden_proposal_expired_event, 4, "proposal_expired_event");
