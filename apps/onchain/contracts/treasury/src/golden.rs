//! Golden payload fixtures for treasury's event-versioned events (issue
//! #1623). See `contracts/event-golden/README.md` for the format and the
//! change workflow.
//!
//! Each event is emitted exactly once by a throwaway harness contract with
//! deterministic arguments, then its serialised topics and data are handed to
//! `event_golden::assert_golden`, which compares them against a committed
//! fixture (or writes it under `UPDATE_GOLDEN=1`).

use soroban_sdk::{contract, contractimpl, testutils::Events, Address, Env, String};

use crate::events::*;
use crate::{ProposalAction, ProposalStatus};

// Deterministic, valid StrKey account addresses. Generated from fixed 32-byte
// seeds so the fixtures never depend on `Address::generate`'s thread RNG.
const ACCOUNTS: [&str; 6] = [
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H",
    "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA",
    "GABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQHGPC",
    "GACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAJJHP",
    "GACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKG7N",
];

fn addr(env: &Env, i: usize) -> Address {
    Address::from_string(&String::from_str(env, ACCOUNTS[i]))
}

#[contract]
pub struct GoldenHarness;

#[contractimpl]
impl GoldenHarness {
    /// Publishes exactly one of treasury's versioned events, selected by
    /// `case`. Kept as a single entrypoint so the test harness stays small.
    pub fn emit(env: Env, case: u32) {
        match case {
            0 => publish_stream_created(&env, addr(&env, 0), 1_000_000, 1_700_000_000, 86_400),
            1 => publish_cliff_stream_created(
                &env,
                addr(&env, 0),
                2_500_000,
                1_700_000_000,
                86_400,
                1_700_043_200,
            ),
            2 => publish_tokens_claimed(&env, addr(&env, 0), 250_000, 750_000),
            3 => publish_beneficiary_rotated(&env, addr(&env, 3), addr(&env, 4), 100, 900),
            4 => publish_proposal_created(&env, 7, addr(&env, 1), ProposalAction::SetAdmin, 2, 3),
            5 => {
                publish_signature_collected(&env, 7, addr(&env, 1), 2, 3, ProposalStatus::Approved)
            }
            6 => {
                publish_proposal_executed(&env, 7, addr(&env, 1), ProposalAction::RotateBeneficiary)
            }
            7 => publish_proposal_cancelled(&env, 7, addr(&env, 1)),
            8 => publish_multisig_configured(&env, addr(&env, 2), 3, 5),
            9 => publish_proposal_expired(&env, 7, 1_700_100_000),
            10 => publish_admin_changed(&env, addr(&env, 1), addr(&env, 2)),
            11 => publish_stream_cancelled(&env, addr(&env, 0), 400_000, 600_000, 1_700_050_000),
            12 => publish_emergency_stop(
                &env,
                addr(&env, 0),
                String::from_str(&env, "oracle anomaly"),
                1_000_000,
            ),
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
            event_golden::assert_golden(&env, "treasury", $event, 1, &topics, &data);
        }
    };
}

golden_case!(golden_stream_created_event, 0, "stream_created_event");
golden_case!(
    golden_cliff_stream_created_event,
    1,
    "cliff_stream_created_event"
);
golden_case!(golden_tokens_claimed_event, 2, "tokens_claimed_event");
golden_case!(
    golden_beneficiary_rotated_event,
    3,
    "beneficiary_rotated_event"
);
golden_case!(golden_proposal_created_event, 4, "proposal_created_event");
golden_case!(
    golden_signature_collected_event,
    5,
    "signature_collected_event"
);
golden_case!(golden_proposal_executed_event, 6, "proposal_executed_event");
golden_case!(
    golden_proposal_cancelled_event,
    7,
    "proposal_cancelled_event"
);
golden_case!(
    golden_multisig_configured_event,
    8,
    "multisig_configured_event"
);
golden_case!(golden_proposal_expired_event, 9, "proposal_expired_event");
golden_case!(golden_admin_changed_event, 10, "admin_changed_event");
golden_case!(golden_stream_cancelled_event, 11, "stream_cancelled_event");
golden_case!(golden_emergency_stop_event, 12, "emergency_stop_event");
