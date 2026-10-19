extern crate std;

use crate::storage::{DataKey, LEDGER_THRESHOLD};
use crate::{
    CommunityCurationContract, CommunityCurationContractClient, CurationError, ProjectMetadata,
    ProjectStatus,
};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
    vec, Address, Env, IntoVal, InvokeError, Map, String, Symbol, TryFromVal, Val,
};

// ─── Parameters Under Test ───────────────────────────────────────────────────
//
// The curation parameters are hard-coded here rather than read back from the
// contract's own getters, so that changing a constant in `lib.rs` surfaces as
// a test failure instead of silently redefining the rules the suite claims to
// verify. The deposit is 1 XLM in stroops, the verify threshold is 30% in
// basis points, and the voting window is 7 days of 5-second ledgers.

/// Proposal deposit, in stroops (1 XLM).
const PROPOSAL_DEPOSIT: i128 = 10_000_000;
/// Share of total voting power that must vote YES to auto-verify, in bps.
const VERIFY_THRESHOLD_BPS: u32 = 3_000;
/// Voting window in ledgers (~5 seconds each); 7 days.
const VOTING_WINDOW: u32 = 120_960;
/// Absolute YES-vote floor, required *in addition to* the percentage
/// threshold, before a proposal auto-verifies.
const MIN_YES_VOTES: u64 = 5;
/// Every event in `events.rs` is published at schema version 1.
const EVENT_VERSION: u32 = 1;

/// Starting ledger sequence for fixtures. Pinned (rather than left at the
/// default) so the window-expiry arithmetic below is explicit.
const START_LEDGER: u32 = 1_000;

/// Funds minted to the proposer, enough to cover every deposit a test pulls.
const PROPOSER_FUNDS: i128 = 1_000_000_000;

// ─── Mock Contributor Registry ───────────────────────────────────────────────
//
// `vote_to_verify` reads voting power through a cross-contract call to
// `get_reputation(address)` and `total_reputation()` on the configured
// contributor registry. This stand-in lets each test size the electorate
// explicitly, and lets reputation move *after* a vote has been cast.

#[contracttype]
#[derive(Clone)]
enum ReputationKey {
    Scores,
}

#[contract]
pub struct MockContributorRegistry;

#[contractimpl]
impl MockContributorRegistry {
    /// Empty constructor — scores are assigned with `set_reputation` so each
    /// test decides who holds how much voting power.
    pub fn __constructor(env: Env) {
        env.storage()
            .instance()
            .set(&ReputationKey::Scores, &Map::<Address, u64>::new(&env));
    }

    pub fn set_reputation(env: Env, contributor: Address, score: u64) {
        let mut scores: Map<Address, u64> = env
            .storage()
            .instance()
            .get(&ReputationKey::Scores)
            .unwrap_or(Map::new(&env));
        scores.set(contributor, score);
        env.storage()
            .instance()
            .set(&ReputationKey::Scores, &scores);
    }

    pub fn get_reputation(env: Env, contributor: Address) -> u64 {
        self::scores(&env).get(contributor).unwrap_or(0)
    }

    /// Sum of every registered score — the total-supply proxy the curation
    /// contract snapshots on the first vote of a proposal.
    pub fn total_reputation(env: Env) -> u64 {
        self::scores(&env)
            .iter()
            .fold(0u64, |acc, (_, score)| acc.saturating_add(score))
    }
}

fn scores(env: &Env) -> Map<Address, u64> {
    env.storage()
        .instance()
        .get(&ReputationKey::Scores)
        .unwrap_or(Map::new(env))
}

// ─── Event Assertion Helpers ─────────────────────────────────────────────────
//
// `#[contractevent]` derives topic 0 from the struct name in snake_case, and
// the `event-versioning` convention (issue #1057) puts the schema version in
// topic 1. Every remaining field lands in the data payload, encoded as a
// `Map<Symbol, Val>` keyed by field name. The helpers below assert on all
// three parts, so a payload regression cannot slip through unnoticed.

/// Event names emitted by `contract` in the most recent invocation tree, in
/// emission order. `env.events().all()` reflects only the most recent
/// invocation, so event assertions have to run before any further contract
/// call — even a read-only getter resets the buffer.
fn emitted_event_names(env: &Env, contract: &Address) -> std::vec::Vec<Symbol> {
    env.events()
        .all()
        .iter()
        .filter(|(emitter, _, _)| emitter == contract)
        .map(|(_, topics, _)| {
            topics
                .get(0)
                .expect("event should have a name topic")
                .into_val(env)
        })
        .collect()
}

fn find_event(
    env: &Env,
    contract: &Address,
    name: &str,
) -> Option<(soroban_sdk::Vec<Val>, Map<Symbol, Val>)> {
    let name_symbol = Symbol::new(env, name);
    for (emitter, topics, data) in env.events().all().iter() {
        if &emitter != contract {
            continue;
        }
        let event_name: Symbol = match topics
            .get(0)
            .map(|topic| TryFromVal::try_from_val(env, &topic))
        {
            Some(Ok(name)) => name,
            _ => continue,
        };
        if event_name != name_symbol {
            continue;
        }
        let payload: Map<Symbol, Val> = TryFromVal::try_from_val(env, &data)
            .expect("curation events are published with a map data payload");
        return Some((topics, payload));
    }
    None
}

/// Asserts `name` was emitted by `contract` at [`EVENT_VERSION`] and that its
/// data payload matches `expected_fields` exactly. Comparing the decoded
/// payload as a whole means a renamed, added, removed, retyped or revalued
/// field all fail here rather than slipping through.
fn assert_event(env: &Env, contract: &Address, name: &str, expected_fields: &[(&str, Val)]) {
    let emitted = emitted_event_names(env, contract);
    let (topics, actual) = find_event(env, contract, name)
        .unwrap_or_else(|| panic!("expected event `{name}` to be emitted, saw: {emitted:?}"));

    assert_eq!(
        topics.len(),
        2,
        "`{name}` should carry the event-name topic and the version topic only"
    );
    let version: u32 = topics.get(1).unwrap().into_val(env);
    assert_eq!(
        version, EVENT_VERSION,
        "`{name}` was published at an unexpected schema version"
    );

    let mut expected = Map::new(env);
    for (field, value) in expected_fields {
        expected.set(Symbol::new(env, field), *value);
    }
    assert_eq!(expected, actual, "`{name}` data payload does not match");
}

/// Asserts the curation contract emitted exactly `expected`, in that order.
fn assert_event_sequence(env: &Env, contract: &Address, expected: &[&str]) {
    let expected_names: std::vec::Vec<Symbol> =
        expected.iter().map(|name| Symbol::new(env, name)).collect();
    assert_eq!(emitted_event_names(env, contract), expected_names);
}

/// Asserts `name` was *not* emitted by `contract` in the most recent
/// invocation tree.
fn assert_no_event(env: &Env, contract: &Address, name: &str) {
    let name_symbol = Symbol::new(env, name);
    let emitted = emitted_event_names(env, contract);
    assert!(
        !emitted.contains(&name_symbol),
        "expected event `{name}` not to be emitted, saw: {emitted:?}"
    );
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

struct Fixture<'a> {
    env: Env,
    contract: Address,
    client: CommunityCurationContractClient<'a>,
    token: StellarAssetClient<'a>,
    token_address: Address,
    registry: MockContributorRegistryClient<'a>,
    admin: Address,
    proposer: Address,
}

impl Fixture<'_> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(START_LEDGER);

        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin);
        let token_address = token.address();
        let token_client = StellarAssetClient::new(&env, &token_address);
        let proposer = Address::generate(&env);
        token_client.mint(&proposer, &PROPOSER_FUNDS);

        let registry = env.register(MockContributorRegistry, ());
        let registry_client = MockContributorRegistryClient::new(&env, &registry);

        let admin = Address::generate(&env);
        let contract = env.register(CommunityCurationContract, ());
        let client = CommunityCurationContractClient::new(&env, &contract);
        client.initialize(&admin, &token_address, &registry);

        Fixture {
            env,
            contract,
            client,
            token: token_client,
            token_address,
            registry: registry_client,
            admin,
            proposer,
        }
    }

    /// Registers a contributor holding `reputation` voting power and returns
    /// its address. Addresses that never call `vote_to_verify` are simply the
    /// rest of the electorate, which is how a test sizes the denominator of
    /// the threshold math — e.g. a 29-power voter alongside a 71-power
    /// non-voter puts YES support at exactly 29%.
    fn voter(&self, reputation: u64) -> Address {
        let voter = Address::generate(&self.env);
        self.registry.set_reputation(&voter, &reputation);
        voter
    }

    /// Proposes a project with valid metadata and returns its id.
    fn propose(&self) -> u64 {
        self.client
            .propose_project(&self.proposer, &sample_metadata(&self.env))
    }

    /// Deposit-token balance currently held by `who`.
    fn balance(&self, who: &Address) -> i128 {
        self.token.balance(who)
    }
}

fn sample_metadata(env: &Env) -> ProjectMetadata {
    ProjectMetadata {
        // A realistic, human-readable name (spaces, mixed case, not 32
        // bytes) — this used to panic `propose_project` outright (see
        // `test_propose_project_with_realistic_name_emits_event` below,
        // fixed under issue #1231) since `emit_project_proposed` forced the
        // name through a fixed 32-byte buffer and a `Symbol` conversion.
        name: String::from_str(env, "My Great Project"),
        description: String::from_str(env, "A project proposed for testing."),
        url: String::from_str(env, "https://example.com"),
        funding_address: Address::generate(env),
    }
}

// ─── State Snapshots ─────────────────────────────────────────────────────────
//
// `ProposalState` deliberately does not derive `PartialEq`, so the fields that
// drive moderation decisions are compared through this snapshot. An invalid
// transition is asserted as "snapshot unchanged".

#[derive(Debug, PartialEq)]
struct Snapshot {
    status: ProjectStatus,
    yes_votes: u64,
    no_votes: u64,
    total_voting_power_snapshot: u64,
    deposit_returned: bool,
}

fn snapshot(client: &CommunityCurationContractClient, project_id: u64) -> Snapshot {
    let state = client
        .get_proposal_state(&project_id)
        .expect("proposal should exist");
    Snapshot {
        status: state.status,
        yes_votes: state.yes_votes,
        no_votes: state.no_votes,
        total_voting_power_snapshot: state.total_voting_power_snapshot,
        deposit_returned: state.deposit_returned,
    }
}

/// The `(approve, voting_power, ledger)` triple recorded for `voter` on
/// `project_id`. `VoteRecord` is not `PartialEq`, so the fields that make up
/// a vote's identity are compared explicitly.
fn vote_decision(
    client: &CommunityCurationContractClient,
    project_id: u64,
    voter: &Address,
) -> (bool, u64, u32) {
    let record = client
        .get_vote(&project_id, voter)
        .expect("vote record should exist");
    (record.approve, record.voting_power, record.ledger)
}

fn status_of(client: &CommunityCurationContractClient, project_id: u64) -> ProjectStatus {
    client
        .get_proposal_state(&project_id)
        .expect("proposal should exist")
        .status
}

// ─── Storage Introspection ───────────────────────────────────────────────────

fn stored_admin(env: &Env, contract: &Address) -> Option<Address> {
    env.as_contract(contract, || env.storage().instance().get(&DataKey::Admin))
}

fn stored_deposit_token(env: &Env, contract: &Address) -> Option<Address> {
    env.as_contract(contract, || {
        env.storage().instance().get(&DataKey::DepositToken)
    })
}

fn stored_next_project_id(env: &Env, contract: &Address) -> Option<u64> {
    env.as_contract(contract, || {
        env.storage().instance().get(&DataKey::NextProjectId)
    })
}

// ─── Authorization Helpers ───────────────────────────────────────────────────

/// Grants a single authorization for `fn_name` on the curation contract to
/// `address`, revoking every other authorization — including the blanket
/// `mock_all_auths` installed by [`Fixture::new`]. This is how the tests
/// assert *which* address an entry point demands, rather than merely that
/// some authorization is required.
fn authorize_only(
    env: &Env,
    address: &Address,
    contract: &Address,
    fn_name: &str,
    args: soroban_sdk::Vec<Val>,
) {
    env.mock_auths(&[MockAuth {
        address,
        invoke: &MockAuthInvoke {
            contract,
            fn_name,
            args,
            sub_invokes: &[],
        },
    }]);
}

// ═════════════════════════════════════════════════════════════════════════════
// initialize
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_initialize_stores_configuration() {
    let f = Fixture::new();

    assert_eq!(stored_admin(&f.env, &f.contract), Some(f.admin.clone()));
    assert_eq!(
        stored_deposit_token(&f.env, &f.contract),
        Some(f.token_address.clone())
    );
    assert_eq!(
        stored_next_project_id(&f.env, &f.contract),
        Some(1u64),
        "the first project id must be 1"
    );
}

#[test]
fn test_initialize_twice_is_rejected() {
    let f = Fixture::new();

    assert_eq!(
        f.client
            .try_initialize(&f.admin, &f.token_address, &Address::generate(&f.env)),
        Err(Ok(CurationError::AlreadyInitialized))
    );

    // Re-initialization must not rotate the admin, or anybody could take over
    // a live curation contract.
    assert_eq!(stored_admin(&f.env, &f.contract), Some(f.admin.clone()));
}

#[test]
fn test_initialize_requires_the_admin_authorization() {
    let f = Fixture::new();
    let uninitialized = f.env.register(CommunityCurationContract, ());
    let intruder = Address::generate(&f.env);

    // Revoke the blanket mocks: nothing is authorized at all.
    f.env.mock_auths(&[]);

    let client = CommunityCurationContractClient::new(&f.env, &uninitialized);
    assert_eq!(
        client.try_initialize(&intruder, &f.token_address, &f.registry.address),
        Err(Err(InvokeError::Abort)),
        "initialize must not succeed without the admin's authorization"
    );
    assert_eq!(
        stored_admin(&f.env, &uninitialized),
        None,
        "a failed initialize must not persist an admin"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// propose_project — entry transition into Pending
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_propose_project_enters_pending_state() {
    let f = Fixture::new();
    let metadata = sample_metadata(&f.env);

    let project_id = f.client.propose_project(&f.proposer, &metadata);
    assert_eq!(project_id, 1);

    let state = f
        .client
        .get_proposal_state(&project_id)
        .expect("proposal should be persisted");
    assert_eq!(state.status, ProjectStatus::Pending);
    assert_eq!(state.project_id, project_id);
    assert_eq!(state.proposer, f.proposer);
    assert_eq!(state.metadata.name, metadata.name);
    assert_eq!(state.metadata.description, metadata.description);
    assert_eq!(state.metadata.url, metadata.url);
    assert_eq!(state.metadata.funding_address, metadata.funding_address);
    assert_eq!(state.yes_votes, 0);
    assert_eq!(state.no_votes, 0);
    assert_eq!(
        state.total_voting_power_snapshot, 0,
        "voting power is snapshotted lazily, on the first vote"
    );
    assert!(!state.deposit_returned);
    assert_eq!(state.created_ledger, START_LEDGER);
    assert_eq!(state.voting_ends_ledger, START_LEDGER + VOTING_WINDOW);
}

#[test]
fn test_propose_project_pulls_the_deposit() {
    let f = Fixture::new();
    let balance_before = f.balance(&f.proposer);

    f.propose();

    assert_eq!(
        f.balance(&f.proposer),
        balance_before - PROPOSAL_DEPOSIT,
        "the deposit must be pulled from the proposer"
    );
    assert_eq!(
        f.balance(&f.contract),
        PROPOSAL_DEPOSIT,
        "the deposit must be escrowed by the contract"
    );
    assert_eq!(f.client.get_deposit_amount(), PROPOSAL_DEPOSIT);
}

#[test]
fn test_propose_project_allocates_monotonic_ids() {
    let f = Fixture::new();

    let first = f.propose();
    let second = f.propose();
    let third = f.propose();

    assert_eq!((first, second, third), (1, 2, 3));
    assert_eq!(f.balance(&f.contract), 3 * PROPOSAL_DEPOSIT);
}

#[test]
fn test_propose_project_with_realistic_name_emits_event() {
    let f = Fixture::new();
    let metadata = sample_metadata(&f.env);

    let project_id = f.client.propose_project(&f.proposer, &metadata);

    assert_event(
        &f.env,
        &f.contract,
        "project_proposed_event",
        &[
            ("project_id", project_id.into_val(&f.env)),
            ("proposer", f.proposer.clone().into_val(&f.env)),
            ("name", metadata.name.clone().into_val(&f.env)),
        ],
    );
    assert_event_sequence(&f.env, &f.contract, &["project_proposed_event"]);
    assert_no_event(&f.env, &f.contract, "project_verified_event");
    assert_no_event(&f.env, &f.contract, "project_rejected_event");
    assert_no_event(&f.env, &f.contract, "proposal_expired_event");
}

#[test]
fn test_propose_project_rejects_invalid_metadata() {
    let f = Fixture::new();
    let empty = String::from_str(&f.env, "");
    let mut cases = std::vec::Vec::new();

    for name in [empty.clone(), String::from_bytes(&f.env, &[b'a'; 101])] {
        let mut metadata = sample_metadata(&f.env);
        metadata.name = name;
        cases.push(metadata);
    }
    for description in [empty, String::from_bytes(&f.env, &[b'b'; 1_001])] {
        let mut metadata = sample_metadata(&f.env);
        metadata.description = description;
        cases.push(metadata);
    }

    let balance_before = f.balance(&f.proposer);
    for (case, metadata) in cases.iter().enumerate() {
        assert_eq!(
            f.client.try_propose_project(&f.proposer, metadata),
            Err(Ok(CurationError::InvalidMetadata)),
            "case {case} should be rejected as invalid metadata"
        );
    }

    assert_eq!(
        f.balance(&f.proposer),
        balance_before,
        "invalid metadata must be rejected before the deposit is pulled"
    );
    assert_eq!(f.balance(&f.contract), 0);
    assert!(
        f.client.get_proposal_state(&1).is_none(),
        "invalid metadata must not consume a project id"
    );
}

#[test]
fn test_propose_project_accepts_boundary_metadata_lengths() {
    let f = Fixture::new();
    let mut metadata = sample_metadata(&f.env);
    metadata.name = String::from_bytes(&f.env, &[b'a'; 100]);
    metadata.description = String::from_bytes(&f.env, &[b'b'; 1_000]);

    let project_id = f.client.propose_project(&f.proposer, &metadata);

    assert_eq!(status_of(&f.client, project_id), ProjectStatus::Pending);
}

#[test]
fn test_propose_project_requires_the_proposer_authorization() {
    let f = Fixture::new();
    let metadata = sample_metadata(&f.env);
    let balance_before = f.balance(&f.proposer);

    // Revoke every authorization: nobody, not even the nominated `proposer`,
    // may escrow funds without signing for the call.
    f.env.mock_auths(&[]);

    assert_eq!(
        f.client.try_propose_project(&f.proposer, &metadata),
        Err(Err(InvokeError::Abort)),
        "propose_project must require the proposer's authorization"
    );
    assert_eq!(f.balance(&f.proposer), balance_before);
    assert_eq!(
        f.balance(&f.contract),
        0,
        "an unauthorized proposer must not be able to escrow funds"
    );
    assert!(f.client.get_proposal_state(&1).is_none());
}

// ═════════════════════════════════════════════════════════════════════════════
// vote_to_verify — Pending → Verified / Pending → Rejected
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_vote_below_threshold_keeps_proposal_pending() {
    let f = Fixture::new();
    let _rest_of_electorate = f.voter(71);
    let voter = f.voter(29);
    let project_id = f.propose();

    f.client.vote_to_verify(&voter, &project_id, &true);

    let state = f
        .client
        .get_proposal_state(&project_id)
        .expect("proposal should exist");
    assert_eq!(
        state.status,
        ProjectStatus::Pending,
        "29 of 100 is below the 30% verify bar"
    );
    assert_eq!(state.yes_votes, 29);
    assert_eq!(state.no_votes, 0);
    assert_eq!(
        state.total_voting_power_snapshot, 100,
        "total voting power is snapshotted on the first vote"
    );
    assert!(!state.deposit_returned);
    assert!(!f.client.is_verified(&project_id));
    assert_eq!(
        f.balance(&f.contract),
        PROPOSAL_DEPOSIT,
        "a still-pending proposal keeps the deposit escrowed"
    );
}

#[test]
fn test_yes_vote_emits_vote_cast_event_with_payload() {
    let f = Fixture::new();
    let _rest_of_electorate = f.voter(71);
    let voter = f.voter(29);
    let project_id = f.propose();

    f.client.vote_to_verify(&voter, &project_id, &true);

    assert_event(
        &f.env,
        &f.contract,
        "vote_cast_event",
        &[
            ("project_id", project_id.into_val(&f.env)),
            ("voter", voter.clone().into_val(&f.env)),
            ("approve", true.into_val(&f.env)),
            ("voting_power", 29u64.into_val(&f.env)),
        ],
    );
    assert_event_sequence(&f.env, &f.contract, &["vote_cast_event"]);
}

#[test]
fn test_no_vote_emits_vote_cast_event_with_payload() {
    let f = Fixture::new();
    let _rest_of_electorate = f.voter(90);
    let voter = f.voter(10);
    let project_id = f.propose();

    f.client.vote_to_verify(&voter, &project_id, &false);

    assert_event(
        &f.env,
        &f.contract,
        "vote_cast_event",
        &[
            ("project_id", project_id.into_val(&f.env)),
            ("voter", voter.clone().into_val(&f.env)),
            ("approve", false.into_val(&f.env)),
            ("voting_power", 10u64.into_val(&f.env)),
        ],
    );
    assert_event_sequence(&f.env, &f.contract, &["vote_cast_event"]);
    let state = f
        .client
        .get_proposal_state(&project_id)
        .expect("proposal should exist");
    assert_eq!(state.no_votes, 10);
    assert_eq!(state.yes_votes, 0);
    assert_eq!(state.status, ProjectStatus::Pending);
}

#[test]
fn test_yes_vote_crossing_threshold_transitions_to_verified() {
    let f = Fixture::new();
    let _rest_of_electorate = f.voter(70);
    let voter = f.voter(30);
    let proposer_balance_at_start = f.balance(&f.proposer);
    let project_id = f.propose();

    f.client.vote_to_verify(&voter, &project_id, &true);

    // The vote is recorded before the transition it triggers, so an indexer
    // never sees `Verified` without the vote that caused it.
    assert_event_sequence(
        &f.env,
        &f.contract,
        &["vote_cast_event", "project_verified_event"],
    );
    assert_event(
        &f.env,
        &f.contract,
        "project_verified_event",
        &[("project_id", project_id.into_val(&f.env))],
    );
    assert_no_event(&f.env, &f.contract, "project_rejected_event");
    assert_no_event(&f.env, &f.contract, "proposal_expired_event");

    assert_eq!(status_of(&f.client, project_id), ProjectStatus::Verified);
    assert!(f.client.is_verified(&project_id));

    let state = f
        .client
        .get_proposal_state(&project_id)
        .expect("proposal should exist");
    assert_eq!(state.yes_votes, 30);
    assert!(
        state.deposit_returned,
        "a verified proposal refunds its deposit"
    );

    assert_eq!(
        f.balance(&f.proposer),
        proposer_balance_at_start,
        "the deposit must be returned to the proposer on verification"
    );
    assert_eq!(f.balance(&f.contract), 0);
}

#[test]
fn test_no_vote_crossing_threshold_transitions_to_rejected() {
    let f = Fixture::new();
    let _rest_of_electorate = f.voter(49);
    let voter = f.voter(51);
    let proposer_balance_at_start = f.balance(&f.proposer);
    let project_id = f.propose();

    f.client.vote_to_verify(&voter, &project_id, &false);

    assert_event_sequence(
        &f.env,
        &f.contract,
        &["vote_cast_event", "project_rejected_event"],
    );
    assert_event(
        &f.env,
        &f.contract,
        "project_rejected_event",
        &[("project_id", project_id.into_val(&f.env))],
    );
    assert_no_event(&f.env, &f.contract, "project_verified_event");
    assert_no_event(&f.env, &f.contract, "proposal_expired_event");

    assert_eq!(status_of(&f.client, project_id), ProjectStatus::Rejected);
    assert!(!f.client.is_verified(&project_id));

    let state = f
        .client
        .get_proposal_state(&project_id)
        .expect("proposal should exist");
    assert_eq!(state.no_votes, 51);
    assert!(
        !state.deposit_returned,
        "a rejected proposal forfeits its deposit"
    );

    assert_eq!(
        f.balance(&f.proposer),
        proposer_balance_at_start - PROPOSAL_DEPOSIT,
        "a rejected proposal must not refund the deposit"
    );
    assert_eq!(f.balance(&f.contract), PROPOSAL_DEPOSIT);
}

#[test]
fn test_verify_threshold_boundaries() {
    // Absolute YES floor: 4 votes out of 4 is unanimous, but still below
    // `MIN_YES_VOTES`, so the proposal must stay pending.
    let below_floor = Fixture::new();
    let sole_voter = below_floor.voter(MIN_YES_VOTES - 1);
    let below_floor_id = below_floor.propose();
    below_floor
        .client
        .vote_to_verify(&sole_voter, &below_floor_id, &true);
    assert_eq!(
        status_of(&below_floor.client, below_floor_id),
        ProjectStatus::Pending,
        "the absolute YES-vote floor applies even at 100% support"
    );

    // Percentage bar: 29/100 is 100 bps short of the threshold.
    let short = Fixture::new();
    let _short_rest = short.voter(71);
    let short_voter = short.voter(29);
    let short_id = short.propose();
    short.client.vote_to_verify(&short_voter, &short_id, &true);
    assert_eq!(status_of(&short.client, short_id), ProjectStatus::Pending);

    // 30/100 is exactly the threshold.
    let exact = Fixture::new();
    let _exact_rest = exact.voter(70);
    let exact_voter = exact.voter(VERIFY_THRESHOLD_BPS as u64 / 100);
    let exact_id = exact.propose();
    exact.client.vote_to_verify(&exact_voter, &exact_id, &true);
    assert_eq!(status_of(&exact.client, exact_id), ProjectStatus::Verified);

    // NO rejection requires a strict majority: exactly 50% does not reject.
    let half = Fixture::new();
    let _half_rest = half.voter(50);
    let half_voter = half.voter(50);
    let half_id = half.propose();
    half.client.vote_to_verify(&half_voter, &half_id, &false);
    assert_eq!(
        status_of(&half.client, half_id),
        ProjectStatus::Pending,
        "50% NO votes are not a strict majority"
    );

    // 51% does.
    let majority = Fixture::new();
    let _majority_rest = majority.voter(49);
    let majority_voter = majority.voter(51);
    let majority_id = majority.propose();
    majority
        .client
        .vote_to_verify(&majority_voter, &majority_id, &false);
    assert_eq!(
        status_of(&majority.client, majority_id),
        ProjectStatus::Rejected
    );
}

#[test]
fn test_thresholds_use_the_snapshot_taken_on_the_first_vote() {
    let f = Fixture::new();
    let rest_of_electorate = f.voter(100);
    let first = f.voter(10);
    let project_id = f.propose();

    f.client.vote_to_verify(&first, &project_id, &true);

    // Reputation grows sharply *after* the snapshot was taken: the electorate
    // is now 236 rather than the recorded 110.
    f.registry.set_reputation(&rest_of_electorate, &200);
    let second = f.voter(26);
    assert_eq!(f.registry.total_reputation(), 236);
    f.client.vote_to_verify(&second, &project_id, &true);

    let state = f
        .client
        .get_proposal_state(&project_id)
        .expect("proposal should exist");
    assert_eq!(
        state.total_voting_power_snapshot, 110,
        "the snapshot must not move after the first vote"
    );
    assert_eq!(state.yes_votes, 36);
    assert_eq!(
        state.status,
        ProjectStatus::Verified,
        "36/110 is 32.7% against the recorded electorate; against a \
         recomputed total it would be 15.2% and stay Pending"
    );
}

#[test]
fn test_vote_is_rejected_for_an_unknown_project() {
    let f = Fixture::new();
    let voter = f.voter(10);

    assert_eq!(
        f.client.try_vote_to_verify(&voter, &404, &true),
        Err(Ok(CurationError::ProjectNotFound))
    );
}

#[test]
fn test_vote_is_rejected_without_reputation() {
    let f = Fixture::new();
    let project_id = f.propose();
    let stranger = Address::generate(&f.env);
    let before = snapshot(&f.client, project_id);

    assert_eq!(
        f.client.try_vote_to_verify(&stranger, &project_id, &true),
        Err(Ok(CurationError::InsufficientReputation))
    );
    assert_eq!(snapshot(&f.client, project_id), before);
    assert!(f.client.get_vote(&project_id, &stranger).is_none());
    assert_no_event(&f.env, &f.contract, "vote_cast_event");
}

#[test]
fn test_vote_is_rejected_after_the_voting_window_expires() {
    let f = Fixture::new();
    let voter = f.voter(10);
    let project_id = f.propose();
    let before = snapshot(&f.client, project_id);

    f.env
        .ledger()
        .set_sequence_number(START_LEDGER + VOTING_WINDOW + 1);

    assert_eq!(
        f.client.try_vote_to_verify(&voter, &project_id, &true),
        Err(Ok(CurationError::VotingWindowExpired))
    );
    assert_eq!(snapshot(&f.client, project_id), before);
    assert!(f.client.get_vote(&project_id, &voter).is_none());
    assert_no_event(&f.env, &f.contract, "vote_cast_event");
}

#[test]
fn test_vote_is_accepted_on_the_last_ledger_of_the_window() {
    let f = Fixture::new();
    let _rest_of_electorate = f.voter(90);
    let voter = f.voter(10);
    let project_id = f.propose();
    let last_ledger = START_LEDGER + VOTING_WINDOW;

    f.env.ledger().set_sequence_number(last_ledger);
    f.client.vote_to_verify(&voter, &project_id, &true);

    let record = f
        .client
        .get_vote(&project_id, &voter)
        .expect("vote record should exist");
    assert!(record.approve);
    assert_eq!(record.voting_power, 10);
    assert_eq!(record.ledger, last_ledger);
    assert_eq!(
        snapshot(&f.client, project_id).status,
        ProjectStatus::Pending,
        "a single 10/100 YES vote neither verifies nor rejects"
    );
}

#[test]
fn test_vote_is_rejected_once_the_proposal_is_verified() {
    let f = Fixture::new();
    let _rest_of_electorate = f.voter(70);
    let decider = f.voter(30);
    let project_id = f.propose();
    f.client.vote_to_verify(&decider, &project_id, &true);
    let before = snapshot(&f.client, project_id);
    // A high-reputation latecomer cannot reopen a settled proposal.
    let latecomer = f.voter(100);

    assert_eq!(
        f.client.try_vote_to_verify(&latecomer, &project_id, &false),
        Err(Ok(CurationError::VotingClosed)),
        "a verified proposal must not accept further votes"
    );
    assert_eq!(snapshot(&f.client, project_id), before);
    assert!(f.client.get_vote(&project_id, &latecomer).is_none());
    assert_no_event(&f.env, &f.contract, "vote_cast_event");
}

#[test]
fn test_vote_is_rejected_once_the_proposal_is_rejected() {
    let f = Fixture::new();
    let _rest_of_electorate = f.voter(49);
    let decider = f.voter(51);
    let project_id = f.propose();
    f.client.vote_to_verify(&decider, &project_id, &false);
    let before = snapshot(&f.client, project_id);
    let latecomer = f.voter(100);

    assert_eq!(
        f.client.try_vote_to_verify(&latecomer, &project_id, &true),
        Err(Ok(CurationError::VotingClosed)),
        "a rejected proposal must not accept further votes"
    );
    assert_eq!(snapshot(&f.client, project_id), before);
    assert!(f.client.get_vote(&project_id, &latecomer).is_none());
    assert_no_event(&f.env, &f.contract, "vote_cast_event");
}

#[test]
fn test_vote_requires_the_voter_authorization() {
    let f = Fixture::new();
    let voter = f.voter(10);
    let project_id = f.propose();
    let before = snapshot(&f.client, project_id);

    f.env.mock_auths(&[]);

    assert_eq!(
        f.client.try_vote_to_verify(&voter, &project_id, &true),
        Err(Err(InvokeError::Abort)),
        "vote_to_verify must require the voter's authorization"
    );
    assert_eq!(snapshot(&f.client, project_id), before);
    assert!(
        f.client.get_vote(&project_id, &voter).is_none(),
        "an unauthorized vote must not be recorded"
    );
    assert_no_event(&f.env, &f.contract, "vote_cast_event");
}

// ─── Vote records and voting power ───────────────────────────────────────────

#[test]
fn test_vote_record_captures_reputation_at_vote_time() {
    let f = Fixture::new();
    let _rest_of_electorate = f.voter(70);
    let voter = f.voter(30);
    let project_id = f.propose();

    assert!(f.client.get_vote(&project_id, &voter).is_none());

    f.client.vote_to_verify(&voter, &project_id, &true);

    let record = f
        .client
        .get_vote(&project_id, &voter)
        .expect("vote record should exist");
    assert_eq!(record.voter, voter);
    assert_eq!(record.project_id, project_id);
    assert!(record.approve);
    assert_eq!(record.voting_power, 30);
    assert_eq!(record.ledger, START_LEDGER);

    // Reputation moves after the vote; the stored record must not be rewritten.
    f.registry.set_reputation(&voter, &1);
    let record_after = f
        .client
        .get_vote(&project_id, &voter)
        .expect("vote record should still exist");
    assert_eq!(record_after.voting_power, 30);
}

#[test]
fn test_votes_from_multiple_voters_accumulate() {
    let f = Fixture::new();
    let alice = f.voter(10);
    let bob = f.voter(15);
    let carol = f.voter(75);
    let project_id = f.propose();
    assert_eq!(f.registry.total_reputation(), 100);

    f.client.vote_to_verify(&alice, &project_id, &true);
    f.client.vote_to_verify(&bob, &project_id, &true);

    let state = f
        .client
        .get_proposal_state(&project_id)
        .expect("proposal should exist");
    assert_eq!(state.yes_votes, 25);
    assert_eq!(
        state.status,
        ProjectStatus::Pending,
        "25/100 is below the verify bar"
    );

    f.client.vote_to_verify(&carol, &project_id, &false);

    let state = f
        .client
        .get_proposal_state(&project_id)
        .expect("proposal should exist");
    assert_eq!(state.yes_votes, 25);
    assert_eq!(state.no_votes, 75);
    assert_eq!(
        state.status,
        ProjectStatus::Rejected,
        "75/100 NO votes are a strict majority"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Idempotent re-submission of the same decision
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_resubmitting_the_same_vote_is_rejected_idempotently() {
    let f = Fixture::new();
    let _rest_of_electorate = f.voter(90);
    let voter = f.voter(10);
    let project_id = f.propose();

    f.client.vote_to_verify(&voter, &project_id, &true);
    let after_first = snapshot(&f.client, project_id);
    let record_after_first = vote_decision(&f.client, project_id, &voter);

    // Re-submitting the identical decision, repeatedly, must never change the
    // outcome, the tally, or the recorded decision.
    for _ in 0..3 {
        assert_eq!(
            f.client.try_vote_to_verify(&voter, &project_id, &true),
            Err(Ok(CurationError::AlreadyVoted))
        );
        assert_eq!(snapshot(&f.client, project_id), after_first);
        assert_eq!(
            vote_decision(&f.client, project_id, &voter),
            record_after_first
        );
    }
    assert_no_event(&f.env, &f.contract, "vote_cast_event");
    assert_no_event(&f.env, &f.contract, "project_verified_event");
}

#[test]
fn test_a_voter_cannot_flip_an_existing_vote() {
    let f = Fixture::new();
    let _rest_of_electorate = f.voter(90);
    let voter = f.voter(10);
    let project_id = f.propose();

    f.client.vote_to_verify(&voter, &project_id, &true);
    let after_yes = snapshot(&f.client, project_id);

    assert_eq!(
        f.client.try_vote_to_verify(&voter, &project_id, &false),
        Err(Ok(CurationError::AlreadyVoted)),
        "re-submission with the opposite decision must be rejected too"
    );
    assert_eq!(snapshot(&f.client, project_id), after_yes);
    assert!(
        f.client
            .get_vote(&project_id, &voter)
            .expect("vote exists")
            .approve,
        "the original decision must stand"
    );
    assert_no_event(&f.env, &f.contract, "vote_cast_event");
}

#[test]
fn test_repeated_admin_rejection_of_the_same_proposal_is_deterministic() {
    let f = Fixture::new();
    let project_id = f.propose();

    f.client.admin_reject(&project_id);
    let after_first = snapshot(&f.client, project_id);
    let proposer_balance_after_first = f.balance(&f.proposer);

    for _ in 0..3 {
        assert_eq!(
            f.client.try_admin_reject(&project_id),
            Err(Ok(CurationError::VotingClosed)),
            "a proposal that is already rejected cannot be rejected again"
        );
        assert_eq!(snapshot(&f.client, project_id), after_first);
        assert_no_event(&f.env, &f.contract, "project_rejected_event");
    }
    assert_eq!(
        f.balance(&f.proposer),
        proposer_balance_after_first,
        "repeated rejection must not move funds"
    );
}

#[test]
fn test_finalize_after_rejection_is_idempotent() {
    let f = Fixture::new();
    let project_id = f.propose();
    f.client.admin_reject(&project_id);
    let after_reject = snapshot(&f.client, project_id);
    f.env
        .ledger()
        .set_sequence_number(START_LEDGER + VOTING_WINDOW + 1);

    for _ in 0..3 {
        assert_eq!(
            f.client.finalize_proposal(&project_id),
            ProjectStatus::Rejected,
            "finalizing an already-rejected proposal returns the settled status"
        );
        assert_eq!(snapshot(&f.client, project_id), after_reject);
        assert_no_event(&f.env, &f.contract, "proposal_expired_event");
    }
}

#[test]
fn test_finalize_after_verification_is_idempotent() {
    let f = Fixture::new();
    let _rest_of_electorate = f.voter(70);
    let voter = f.voter(30);
    let project_id = f.propose();
    f.client.vote_to_verify(&voter, &project_id, &true);
    let after_verify = snapshot(&f.client, project_id);
    f.env
        .ledger()
        .set_sequence_number(START_LEDGER + VOTING_WINDOW + 1);

    for _ in 0..3 {
        assert_eq!(
            f.client.finalize_proposal(&project_id),
            ProjectStatus::Verified,
            "finalizing a verified proposal must not reject it"
        );
        assert_eq!(snapshot(&f.client, project_id), after_verify);
        assert_no_event(&f.env, &f.contract, "proposal_expired_event");
        assert_no_event(&f.env, &f.contract, "project_rejected_event");
    }
    assert!(
        after_verify.deposit_returned,
        "the deposit was already refunded by the verifying vote"
    );
    assert_eq!(
        f.balance(&f.contract),
        0,
        "repeated finalization must not refund the deposit twice"
    );
}

#[test]
fn test_repeated_identical_proposals_stay_independent() {
    let f = Fixture::new();
    let metadata = sample_metadata(&f.env);

    let first = f.client.propose_project(&f.proposer, &metadata);
    let second = f.client.propose_project(&f.proposer, &metadata);

    assert_ne!(
        first, second,
        "re-submitting an identical proposal must not collide with the first"
    );
    assert_eq!(status_of(&f.client, first), ProjectStatus::Pending);
    assert_eq!(status_of(&f.client, second), ProjectStatus::Pending);
    assert_eq!(
        f.balance(&f.contract),
        2 * PROPOSAL_DEPOSIT,
        "each proposal escrows its own deposit"
    );

    // The two projects are voted on independently.
    let voter = f.voter(30);
    f.client.vote_to_verify(&voter, &first, &true);
    assert_eq!(status_of(&f.client, first), ProjectStatus::Verified);
    assert_eq!(status_of(&f.client, second), ProjectStatus::Pending);
    assert_eq!(
        f.balance(&f.contract),
        PROPOSAL_DEPOSIT,
        "only the verified proposal gets its deposit back"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// finalize_proposal — Pending → Rejected on window expiry
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_finalize_proposal_rejects_an_expired_proposal() {
    let f = Fixture::new();
    let proposer_balance_at_start = f.balance(&f.proposer);
    let project_id = f.propose();
    f.env
        .ledger()
        .set_sequence_number(START_LEDGER + VOTING_WINDOW + 1);

    let status = f.client.finalize_proposal(&project_id);

    assert_event_sequence(&f.env, &f.contract, &["proposal_expired_event"]);
    assert_event(
        &f.env,
        &f.contract,
        "proposal_expired_event",
        &[("project_id", project_id.into_val(&f.env))],
    );
    assert_no_event(&f.env, &f.contract, "project_rejected_event");
    assert_no_event(&f.env, &f.contract, "project_verified_event");

    assert_eq!(status, ProjectStatus::Rejected);
    assert_eq!(status_of(&f.client, project_id), ProjectStatus::Rejected);
    assert!(!f.client.is_verified(&project_id));

    let state = f
        .client
        .get_proposal_state(&project_id)
        .expect("proposal should exist");
    assert!(
        !state.deposit_returned,
        "an expiry-rejected proposal forfeits its deposit"
    );
    assert_eq!(
        f.balance(&f.proposer),
        proposer_balance_at_start - PROPOSAL_DEPOSIT,
        "expiry must not refund the deposit"
    );
    assert_eq!(f.balance(&f.contract), PROPOSAL_DEPOSIT);
}

#[test]
fn test_finalize_proposal_is_blocked_while_the_window_is_open() {
    let f = Fixture::new();
    let project_id = f.propose();
    let before = snapshot(&f.client, project_id);

    // The last ledger of the window is still open for voting *and* blocked
    // from finalizing.
    f.env
        .ledger()
        .set_sequence_number(START_LEDGER + VOTING_WINDOW);

    assert_eq!(
        f.client.try_finalize_proposal(&project_id),
        Err(Ok(CurationError::VotingWindowNotExpired))
    );
    assert_eq!(snapshot(&f.client, project_id), before);
    assert_no_event(&f.env, &f.contract, "proposal_expired_event");
}

#[test]
fn test_finalize_proposal_is_rejected_for_an_unknown_project() {
    let f = Fixture::new();

    assert_eq!(
        f.client.try_finalize_proposal(&404),
        Err(Ok(CurationError::ProjectNotFound))
    );
}

#[test]
fn test_finalize_proposal_is_permissionless() {
    let f = Fixture::new();
    let project_id = f.propose();
    f.env
        .ledger()
        .set_sequence_number(START_LEDGER + VOTING_WINDOW + 1);

    // Anyone may sweep up an expired proposal, so no authorization at all is
    // required to move it out of `Pending`.
    f.env.mock_auths(&[]);

    assert_eq!(
        f.client.finalize_proposal(&project_id),
        ProjectStatus::Rejected
    );
    assert_eq!(status_of(&f.client, project_id), ProjectStatus::Rejected);
}

// ═════════════════════════════════════════════════════════════════════════════
// admin_reject — Pending → Rejected (admin override)
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_admin_reject_transitions_pending_to_rejected() {
    let f = Fixture::new();
    let proposer_balance_at_start = f.balance(&f.proposer);
    let project_id = f.propose();

    f.client.admin_reject(&project_id);

    assert_event_sequence(&f.env, &f.contract, &["project_rejected_event"]);
    assert_event(
        &f.env,
        &f.contract,
        "project_rejected_event",
        &[("project_id", project_id.into_val(&f.env))],
    );
    assert_no_event(&f.env, &f.contract, "proposal_expired_event");
    assert_no_event(&f.env, &f.contract, "project_verified_event");

    assert_eq!(status_of(&f.client, project_id), ProjectStatus::Rejected);
    assert!(!f.client.is_verified(&project_id));
    let state = f
        .client
        .get_proposal_state(&project_id)
        .expect("proposal should exist");
    assert!(
        !state.deposit_returned,
        "an admin rejection forfeits the deposit"
    );
    assert_eq!(
        f.balance(&f.proposer),
        proposer_balance_at_start - PROPOSAL_DEPOSIT,
        "an admin rejection forfeits the deposit"
    );
    assert_eq!(f.balance(&f.contract), PROPOSAL_DEPOSIT);
}

#[test]
fn test_admin_reject_is_rejected_for_an_unknown_project() {
    let f = Fixture::new();

    assert_eq!(
        f.client.try_admin_reject(&404),
        Err(Ok(CurationError::ProjectNotFound))
    );
    assert_no_event(&f.env, &f.contract, "project_rejected_event");
}

#[test]
fn test_admin_reject_is_rejected_for_a_verified_proposal() {
    let f = Fixture::new();
    let _rest_of_electorate = f.voter(70);
    let voter = f.voter(30);
    let project_id = f.propose();
    f.client.vote_to_verify(&voter, &project_id, &true);
    let before = snapshot(&f.client, project_id);

    assert_eq!(
        f.client.try_admin_reject(&project_id),
        Err(Ok(CurationError::VotingClosed)),
        "a verified proposal is terminal and cannot be admin-rejected"
    );
    assert_eq!(snapshot(&f.client, project_id), before);
    assert!(
        before.deposit_returned,
        "a failed admin rejection must not un-refund the deposit"
    );
    assert_no_event(&f.env, &f.contract, "project_rejected_event");
}

#[test]
fn test_admin_reject_is_rejected_for_a_rejected_proposal() {
    let f = Fixture::new();
    let project_id = f.propose();
    f.client.admin_reject(&project_id);
    let before = snapshot(&f.client, project_id);

    assert_eq!(
        f.client.try_admin_reject(&project_id),
        Err(Ok(CurationError::VotingClosed)),
        "a rejected proposal cannot be rejected twice"
    );
    assert_eq!(snapshot(&f.client, project_id), before);
    assert_no_event(&f.env, &f.contract, "project_rejected_event");
}

#[test]
fn test_admin_reject_still_applies_to_an_expired_unfinalized_proposal() {
    // An expired-but-unfinalized proposal is still `Pending`, so an admin may
    // still reject it. This pins the ordering of the two exit paths so the
    // moderation backend can rely on exactly one transition event firing.
    let f = Fixture::new();
    let project_id = f.propose();
    f.env
        .ledger()
        .set_sequence_number(START_LEDGER + VOTING_WINDOW + 1);

    f.client.admin_reject(&project_id);

    assert_event_sequence(&f.env, &f.contract, &["project_rejected_event"]);
    assert_no_event(&f.env, &f.contract, "proposal_expired_event");
    assert_eq!(status_of(&f.client, project_id), ProjectStatus::Rejected);
}

#[test]
fn test_admin_reject_requires_the_configured_admin_authorization() {
    let f = Fixture::new();
    let project_id = f.propose();
    let before = snapshot(&f.client, project_id);
    let intruder = Address::generate(&f.env);

    // An authorization is supplied — but for the wrong address. `admin_reject`
    // must demand the stored admin specifically.
    authorize_only(
        &f.env,
        &intruder,
        &f.contract,
        "admin_reject",
        vec![&f.env, project_id.into_val(&f.env)],
    );

    assert_eq!(
        f.client.try_admin_reject(&project_id),
        Err(Err(InvokeError::Abort)),
        "a non-admin authorization must not satisfy admin_reject"
    );
    assert_eq!(
        snapshot(&f.client, project_id),
        before,
        "a rejected admin call must leave the proposal pending"
    );
    assert_no_event(&f.env, &f.contract, "project_rejected_event");

    // The configured admin's authorization is the one that is accepted.
    authorize_only(
        &f.env,
        &f.admin,
        &f.contract,
        "admin_reject",
        vec![&f.env, project_id.into_val(&f.env)],
    );
    f.client.admin_reject(&project_id);
    assert_eq!(status_of(&f.client, project_id), ProjectStatus::Rejected);
}

#[test]
fn test_admin_reject_requires_an_authorization_to_be_present() {
    let f = Fixture::new();
    let project_id = f.propose();
    let before = snapshot(&f.client, project_id);

    f.env.mock_auths(&[]);

    assert_eq!(
        f.client.try_admin_reject(&project_id),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(snapshot(&f.client, project_id), before);
    assert_no_event(&f.env, &f.contract, "project_rejected_event");
}

// ═════════════════════════════════════════════════════════════════════════════
// Queries
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_is_verified_tracks_the_status() {
    let f = Fixture::new();
    let decider = f.voter(30);
    let rejecter = f.voter(51);
    assert_eq!(f.registry.total_reputation(), 81);

    let verified_id = f.propose();
    let rejected_id = f.propose();
    let pending_id = f.propose();

    assert!(!f.client.is_verified(&pending_id));
    assert!(
        !f.client.is_verified(&404),
        "an unknown project is never verified"
    );

    f.client.vote_to_verify(&decider, &verified_id, &true);
    f.client.vote_to_verify(&rejecter, &rejected_id, &false);

    assert!(f.client.is_verified(&verified_id));
    assert!(!f.client.is_verified(&rejected_id));
    assert!(!f.client.is_verified(&pending_id));
}

#[test]
fn test_get_proposal_state_returns_none_for_an_unknown_project() {
    let f = Fixture::new();

    assert!(f.client.get_proposal_state(&0).is_none());
    assert!(f.client.get_proposal_state(&404).is_none());
}

#[test]
fn test_constants_match_the_documented_parameters() {
    let f = Fixture::new();

    assert_eq!(f.client.get_deposit_amount(), 10_000_000);
    assert_eq!(f.client.get_verify_threshold_bps(), 3_000);
    assert_eq!(f.client.get_voting_window_ledgers(), 120_960);
}

#[test]
fn test_error_codes_are_stable_for_off_chain_decoders() {
    // The moderation backend keys off these numeric codes, so they are part of
    // the contract's public surface even though two of them are not returned
    // by any entry point today.
    assert_eq!(CurationError::AlreadyInitialized as u32, 1);
    assert_eq!(CurationError::NotInitialized as u32, 2);
    assert_eq!(CurationError::ProjectNotFound as u32, 3);
    assert_eq!(CurationError::VotingClosed as u32, 4);
    assert_eq!(CurationError::VotingWindowExpired as u32, 5);
    assert_eq!(CurationError::VotingWindowNotExpired as u32, 6);
    assert_eq!(CurationError::AlreadyVoted as u32, 7);
    assert_eq!(CurationError::InsufficientReputation as u32, 8);
    assert_eq!(CurationError::InvalidMetadata as u32, 9);
    assert_eq!(CurationError::Unauthorized as u32, 10);
}

// ═════════════════════════════════════════════════════════════════════════════
// Storage lifetime
// ═════════════════════════════════════════════════════════════════════════════

/// Advances the ledger sequence past `LEDGER_THRESHOLD` repeatedly and
/// exercises reads and writes at each step, so a persistent or instance
/// entry that was never re-bumped would fail to be found and this test
/// would fail.
#[test]
fn test_ttl_extended_after_read_write() {
    let f = Fixture::new();

    let metadata = sample_metadata(&f.env);
    let project_id = f.client.propose_project(&f.proposer, &metadata);

    // Advance past LEDGER_THRESHOLD once: a read should re-bump both the
    // instance (Admin/DepositToken/ContributorRegistry/NextProjectId) and
    // the per-project persistent `Proposal` entry.
    f.env.ledger().set_sequence_number(LEDGER_THRESHOLD + 1);
    let proposal = f
        .client
        .get_proposal_state(&project_id)
        .expect("proposal should exist");
    assert_eq!(proposal.status, ProjectStatus::Pending);
    assert!(!f.client.is_verified(&project_id));

    // Advance again — this only survives if the prior read actually
    // extended the TTL rather than leaving it to expire.
    f.env.ledger().set_sequence_number(2 * LEDGER_THRESHOLD + 2);
    let proposal = f
        .client
        .get_proposal_state(&project_id)
        .expect("proposal should exist");
    assert_eq!(proposal.status, ProjectStatus::Pending);

    // An admin write after a long gap must also succeed, and must itself
    // keep protecting the entries it touches (Admin instance key,
    // Proposal persistent key).
    f.env.ledger().set_sequence_number(3 * LEDGER_THRESHOLD + 3);
    f.client.admin_reject(&project_id);

    f.env.ledger().set_sequence_number(4 * LEDGER_THRESHOLD + 4);
    let proposal = f
        .client
        .get_proposal_state(&project_id)
        .expect("proposal should exist");
    assert_eq!(proposal.status, ProjectStatus::Rejected);

    // A second proposal after the long gap must also succeed — proves the
    // instance-tier NextProjectId counter and DepositToken/Admin survived.
    let second_id = f.propose();
    assert_eq!(second_id, project_id + 1);
}
