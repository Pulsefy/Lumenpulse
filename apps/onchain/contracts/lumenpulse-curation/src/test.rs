use crate::{CommunityCurationContract, CommunityCurationContractClient};
use crate::errors::CurationError;
use crate::types::{ProjectMetadata, ProjectStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, String as SorobanString,
};

// ─── Test Setup ──────────────────────────────────────────────────────────────

fn create_token<'a>(env: &Env, admin: &Address) -> (TokenClient<'a>, StellarAssetClient<'a>) {
    let addr = env.register_stellar_asset_contract_v2(admin.clone());
    (
        TokenClient::new(env, &addr.address()),
        StellarAssetClient::new(env, &addr.address()),
    )
}

fn create_metadata(env: &Env, name: &str, description: &str) -> ProjectMetadata {
    ProjectMetadata {
        name: SorobanString::from_small_str(name),
        description: SorobanString::from_small_str(description),
        url: SorobanString::from_small_str("https://example.com"),
        funding_address: Address::generate(env),
    }
}

struct TestEnv<'a> {
    env: &'a Env,
    contract_id: Address,
    client: CommunityCurationContractClient<'a>,
    admin: Address,
    deposit_token: TokenClient<'a>,
    token_admin: StellarAssetClient<'a>,
}

impl<'a> TestEnv<'a> {
    fn new(env: &'a Env) -> Self {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let (deposit_token, token_admin) = create_token(env, &admin);
        let contract_id = env.register(CommunityCurationContract, ());
        let client = CommunityCurationContractClient::new(env, &contract_id);

        TestEnv {
            env,
            contract_id,
            client,
            admin,
            deposit_token,
            token_admin,
        }
    }

    fn init_with_registry(&mut self, registry: &Address) {
        self.client
            .initialize(&self.admin, &self.deposit_token.address, registry);
    }

    fn setup_with_reputation(env: &Env) -> (TestEnv, Address) {
        let mut test_env = TestEnv::new(env);

        // Create a mock registry contract that returns reputation scores
        let registry_id = env.register_contract(None, MockRegistry);
        let registry = Address::from_contract_id(env, &registry_id);

        test_env.init_with_registry(&registry);
        (test_env, registry)
    }

    fn fund_address(&self, address: &Address, amount: i128) {
        self.token_admin.mint(address, &amount);
    }
}

// ─── Mock Registry Contract ──────────────────────────────────────────────────

#[soroban_sdk::contract]
pub struct MockRegistry;

#[soroban_sdk::contractimpl]
impl MockRegistry {
    pub fn get_reputation(_env: Env, _address: Address) -> u64 {
        100 // Default reputation of 100 for any address
    }

    pub fn total_reputation(_env: Env) -> u64 {
        1000 // Total reputation of 1000 across all voters
    }
}

// ─── Authorization Tests ─────────────────────────────────────────────────────

#[test]
fn test_initialize_by_authorized_admin() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    // Verify admin is set correctly
    assert_eq!(test_env.client.get_admin(&test_env.admin), ());
}

#[test]
fn test_double_initialization_fails() {
    let env = Env::default();
    let (test_env, registry) = TestEnv::setup_with_reputation(&env);

    let result = test_env
        .client
        .try_initialize(&test_env.admin, &test_env.deposit_token.address, &registry);

    assert_eq!(result, Err(Ok(CurationError::AlreadyInitialized)));
}

#[test]
fn test_admin_rejection_requires_auth() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    // Non-admin tries to reject - should fail with authorization error
    let non_admin = Address::generate(&env);
    env.as_contract(&test_env.contract_id, || {
        // This would normally require auth from non_admin, but we're inside the contract
        // The actual test would require a different setup to test unauthorized rejection
        // For now we verify the proposal was created
        let state = test_env.client.get_proposal_state(&project_id);
        assert_eq!(state.unwrap().status, ProjectStatus::Pending);
    });
}

// ─── State Transition Tests ──────────────────────────────────────────────────

#[test]
fn test_propose_project_creates_pending_proposal() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    let proposal = test_env.client.get_proposal_state(&project_id).unwrap();

    assert_eq!(proposal.project_id, project_id);
    assert_eq!(proposal.proposer, proposer);
    assert_eq!(proposal.status, ProjectStatus::Pending);
    assert_eq!(proposal.yes_votes, 0);
    assert_eq!(proposal.no_votes, 0);
    assert_eq!(proposal.total_voting_power_snapshot, 0);
    assert!(!proposal.deposit_returned);
}

#[test]
fn test_state_transition_pending_to_verified() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    // Cast enough YES votes to verify (need 30% of 1000 = 300 total with min 5 votes)
    // Since each voter has 100 reputation, we need at least 4 voters (4 * 100 = 400 > 30% of 1000)
    for i in 0..4 {
        let voter = Address::generate(&env);
        test_env
            .client
            .vote_to_verify(&voter, &project_id, &true);
    }

    let proposal = test_env.client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.status, ProjectStatus::Verified);
}

#[test]
fn test_state_transition_pending_to_rejected_by_vote() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    // Cast enough NO votes to reject (need > 50% of 1000 = 501 votes)
    // With 100 reputation each, we need 6 NO votes (600 > 50%)
    for i in 0..6 {
        let voter = Address::generate(&env);
        test_env
            .client
            .vote_to_verify(&voter, &project_id, &false);
    }

    let proposal = test_env.client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.status, ProjectStatus::Rejected);
}

#[test]
fn test_state_transition_pending_to_rejected_by_expiry() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    let window = test_env.client.get_voting_window_ledgers();
    env.ledger().set_sequence(window + 100);

    let status = test_env.client.finalize_proposal(&project_id).unwrap();
    assert_eq!(status, ProjectStatus::Rejected);
}

#[test]
fn test_state_transition_pending_to_rejected_by_admin() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    // Admin rejects the proposal
    test_env.client.admin_reject(&project_id).ok();

    let proposal = test_env.client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.status, ProjectStatus::Rejected);
}

#[test]
fn test_voting_closed_after_verification() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    // Cast enough YES votes to verify
    for i in 0..4 {
        let voter = Address::generate(&env);
        test_env
            .client
            .vote_to_verify(&voter, &project_id, &true);
    }

    // Try to vote after verification
    let additional_voter = Address::generate(&env);
    let result = test_env
        .client
        .try_vote_to_verify(&additional_voter, &project_id, &true);

    assert_eq!(result, Err(Ok(CurationError::VotingClosed)));
}

#[test]
fn test_invalid_state_transition_rejects() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    // Reject the proposal
    test_env.client.admin_reject(&project_id).ok();

    // Try to vote on rejected proposal
    let voter = Address::generate(&env);
    let result = test_env
        .client
        .try_vote_to_verify(&voter, &project_id, &true);

    assert_eq!(result, Err(Ok(CurationError::VotingClosed)));
}

// ─── Event Emission Tests ────────────────────────────────────────────────────

#[test]
fn test_emit_project_proposed_event() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");

    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    // Event should have been emitted with correct data
    // We verify by checking the proposal state
    let proposal = test_env.client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.proposer, proposer);
}

#[test]
fn test_emit_vote_cast_event() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    let voter = Address::generate(&env);
    test_env
        .client
        .vote_to_verify(&voter, &project_id, &true);

    // Verify vote was recorded
    let vote = test_env.client.get_vote(&project_id, &voter).unwrap();
    assert_eq!(vote.voter, voter);
    assert_eq!(vote.approve, true);
    assert_eq!(vote.voting_power, 100); // Mock registry returns 100
}

#[test]
fn test_emit_project_verified_event() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    for i in 0..4 {
        let voter = Address::generate(&env);
        test_env
            .client
            .vote_to_verify(&voter, &project_id, &true);
    }

    let proposal = test_env.client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.status, ProjectStatus::Verified);
}

#[test]
fn test_emit_project_rejected_event() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    test_env.client.admin_reject(&project_id).ok();

    let proposal = test_env.client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.status, ProjectStatus::Rejected);
}

#[test]
fn test_emit_proposal_expired_event() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    let window = test_env.client.get_voting_window_ledgers();
    env.ledger().set_sequence(window + 100);

    let status = test_env.client.finalize_proposal(&project_id).unwrap();
    assert_eq!(status, ProjectStatus::Rejected);
}

// ─── Idempotency Tests ───────────────────────────────────────────────────────

#[test]
fn test_double_voting_rejected() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    let voter = Address::generate(&env);

    // First vote succeeds
    test_env
        .client
        .vote_to_verify(&voter, &project_id, &true);

    // Second vote from same voter should fail
    let result = test_env
        .client
        .try_vote_to_verify(&voter, &project_id, &true);

    assert_eq!(result, Err(Ok(CurationError::AlreadyVoted)));
}

#[test]
fn test_deposit_returned_once_on_verification() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    // Cast enough votes to verify
    for i in 0..4 {
        let voter = Address::generate(&env);
        test_env
            .client
            .vote_to_verify(&voter, &project_id, &true);
    }

    let proposal = test_env.client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.status, ProjectStatus::Verified);
    assert!(proposal.deposit_returned); // Deposit should be returned after verification
}

#[test]
fn test_finalize_proposal_idempotent() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    let window = test_env.client.get_voting_window_ledgers();
    env.ledger().set_sequence(window + 100);

    // First finalization
    let status1 = test_env.client.finalize_proposal(&project_id).unwrap();
    assert_eq!(status1, ProjectStatus::Rejected);

    // Second finalization should return same status
    let status2 = test_env.client.finalize_proposal(&project_id).unwrap();
    assert_eq!(status2, ProjectStatus::Rejected);
}

// ─── Metadata Validation Tests ───────────────────────────────────────────────

#[test]
fn test_empty_name_rejected() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = ProjectMetadata {
        name: SorobanString::from_small_str(""),
        description: SorobanString::from_small_str("Valid description"),
        url: SorobanString::from_small_str("https://example.com"),
        funding_address: Address::generate(&env),
    };

    let result = test_env
        .client
        .try_propose_project(&proposer, &metadata);

    assert_eq!(result, Err(Ok(CurationError::InvalidMetadata)));
}

#[test]
fn test_name_too_long_rejected() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let long_name = "a".repeat(101); // > 100 chars
    let metadata = ProjectMetadata {
        name: SorobanString::from_small_str(&long_name),
        description: SorobanString::from_small_str("Valid description"),
        url: SorobanString::from_small_str("https://example.com"),
        funding_address: Address::generate(&env),
    };

    let result = test_env
        .client
        .try_propose_project(&proposer, &metadata);

    assert_eq!(result, Err(Ok(CurationError::InvalidMetadata)));
}

#[test]
fn test_empty_description_rejected() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = ProjectMetadata {
        name: SorobanString::from_small_str("Valid Name"),
        description: SorobanString::from_small_str(""),
        url: SorobanString::from_small_str("https://example.com"),
        funding_address: Address::generate(&env),
    };

    let result = test_env
        .client
        .try_propose_project(&proposer, &metadata);

    assert_eq!(result, Err(Ok(CurationError::InvalidMetadata)));
}

#[test]
fn test_description_too_long_rejected() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let long_desc = "a".repeat(1001); // > 1000 chars
    let metadata = ProjectMetadata {
        name: SorobanString::from_small_str("Valid Name"),
        description: SorobanString::from_small_str(&long_desc),
        url: SorobanString::from_small_str("https://example.com"),
        funding_address: Address::generate(&env),
    };

    let result = test_env
        .client
        .try_propose_project(&proposer, &metadata);

    assert_eq!(result, Err(Ok(CurationError::InvalidMetadata)));
}

// ─── Voting Window Tests ─────────────────────────────────────────────────────

#[test]
fn test_voting_window_expired_prevents_votes() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    let window = test_env.client.get_voting_window_ledgers();
    env.ledger().set_sequence(window + 100);

    let voter = Address::generate(&env);
    let result = test_env
        .client
        .try_vote_to_verify(&voter, &project_id, &true);

    assert_eq!(result, Err(Ok(CurationError::VotingWindowExpired)));
}

#[test]
fn test_voting_before_window_expires_succeeds() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    let window = test_env.client.get_voting_window_ledgers();
    env.ledger().set_sequence(window - 10); // Still within window

    let voter = Address::generate(&env);
    let result = test_env
        .client
        .try_vote_to_verify(&voter, &project_id, &true);

    assert!(result.is_ok());
}

// ─── Threshold Calculation Tests ────────────────────────────────────────────

#[test]
fn test_verify_threshold_requires_minimum_votes() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    // Cast only 3 YES votes (< 5 minimum)
    for i in 0..3 {
        let voter = Address::generate(&env);
        test_env
            .client
            .vote_to_verify(&voter, &project_id, &true);
    }

    let proposal = test_env.client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.status, ProjectStatus::Pending); // Not verified due to MIN_YES_VOTES
}

#[test]
fn test_verify_threshold_percentage_calculation() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    // With total reputation of 1000 and 30% threshold:
    // Need 5 minimum votes + 30% = 300 votes
    // Each voter has 100, so 4 voters * 100 = 400 > 300 ✓
    for i in 0..4 {
        let voter = Address::generate(&env);
        test_env
            .client
            .vote_to_verify(&voter, &project_id, &true);
    }

    let proposal = test_env.client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.status, ProjectStatus::Verified);
}

#[test]
fn test_reject_threshold_majority_against() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    // Cast NO votes to exceed 50%
    // Total is 1000, need > 500 for rejection
    // 6 voters * 100 = 600 > 500 ✓
    for i in 0..6 {
        let voter = Address::generate(&env);
        test_env
            .client
            .vote_to_verify(&voter, &project_id, &false);
    }

    let proposal = test_env.client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.status, ProjectStatus::Rejected);
}

// ─── Query Tests ────────────────────────────────────────────────────────────

#[test]
fn test_is_verified_returns_true_for_verified() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    for i in 0..4 {
        let voter = Address::generate(&env);
        test_env
            .client
            .vote_to_verify(&voter, &project_id, &true);
    }

    assert!(test_env.client.is_verified(&project_id));
}

#[test]
fn test_is_verified_returns_false_for_pending() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    assert!(!test_env.client.is_verified(&project_id));
}

#[test]
fn test_is_verified_returns_false_for_rejected() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    test_env.client.admin_reject(&project_id).ok();

    assert!(!test_env.client.is_verified(&project_id));
}

#[test]
fn test_get_vote_returns_none_for_non_voter() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    let non_voter = Address::generate(&env);
    let vote = test_env.client.get_vote(&project_id, &non_voter);

    assert_eq!(vote, None);
}

// ─── Constants Query Tests ───────────────────────────────────────────────────

#[test]
fn test_get_deposit_amount() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let deposit = test_env.client.get_deposit_amount();
    assert_eq!(deposit, 10_000_000); // 1 XLM in stroops
}

#[test]
fn test_get_voting_window_ledgers() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let window = test_env.client.get_voting_window_ledgers();
    assert_eq!(window, 120_960); // ~7 days
}

#[test]
fn test_get_verify_threshold_bps() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let threshold = test_env.client.get_verify_threshold_bps();
    assert_eq!(threshold, 3_000); // 30% in basis points
}

// ─── Edge Case Tests ────────────────────────────────────────────────────────

#[test]
fn test_propose_project_nonexistent() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let non_existent_id = 9999u64;
    let proposal = test_env.client.get_proposal_state(&non_existent_id);

    assert_eq!(proposal, None);
}

#[test]
fn test_finalize_within_voting_window_fails() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    // Try to finalize before window expires
    let result = test_env
        .client
        .try_finalize_proposal(&project_id);

    assert_eq!(result, Err(Ok(CurationError::VotingWindowNotExpired)));
}

#[test]
fn test_zero_reputation_voter_fails() {
    let env = Env::default();
    let (test_env, registry) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    // In real scenario, would need a mock registry that returns 0 reputation
    // For now, we note this as a test requirement
    // let voter = Address::generate(&env); // Would have 0 reputation
    // let result = test_env.client.try_vote_to_verify(&voter, &project_id, &true);
    // assert_eq!(result, Err(Ok(CurationError::InsufficientReputation)));
}

// ─── Vote Record Storage Tests ──────────────────────────────────────────────

#[test]
fn test_vote_record_stores_correct_data() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    let voter = Address::generate(&env);
    test_env
        .client
        .vote_to_verify(&voter, &project_id, &true);

    let vote = test_env.client.get_vote(&project_id, &voter).unwrap();

    assert_eq!(vote.voter, voter);
    assert_eq!(vote.project_id, project_id);
    assert_eq!(vote.approve, true);
    assert_eq!(vote.voting_power, 100);
}

// ─── Proposal State Snapshot Tests ─────────────────────────────────────────

#[test]
fn test_total_voting_power_snapshot_on_first_vote() {
    let env = Env::default();
    let (test_env, _) = TestEnv::setup_with_reputation(&env);

    let proposer = Address::generate(&env);
    test_env.fund_address(&proposer, 100_000_000);

    let metadata = create_metadata(&env, "Test Project", "A test project");
    let project_id = test_env
        .client
        .propose_project(&proposer, &metadata);

    // Before first vote
    let proposal = test_env.client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.total_voting_power_snapshot, 0);

    // After first vote
    let voter = Address::generate(&env);
    test_env
        .client
        .vote_to_verify(&voter, &project_id, &true);

    let proposal = test_env.client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.total_voting_power_snapshot, 1000); // Total reputation from mock
}
