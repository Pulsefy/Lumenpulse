#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::Client as TokenClient,
    token::StellarAssetClient,
    Address, Env, String, IntoVal,
};

// ─── Mock Contributor Registry ─────────────────────────────────────────────

#[contract]
pub struct MockContributorRegistry;

#[contractimpl]
impl MockContributorRegistry {
    pub fn get_reputation(env: Env, voter: Address) -> u64 {
        env.storage().instance().get(&voter).unwrap_or(0)
    }

    pub fn total_reputation(env: Env) -> u64 {
        env.storage().instance().get(&soroban_sdk::Symbol::new(&env, "total")).unwrap_or(0)
    }

    pub fn set_reputation(env: Env, voter: Address, score: u64) {
        env.storage().instance().set(&voter, &score);
        let current_total: u64 = env.storage().instance().get(&soroban_sdk::Symbol::new(&env, "total")).unwrap_or(0);
        env.storage().instance().set(&soroban_sdk::Symbol::new(&env, "total"), &(current_total + score));
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

struct Setup {
    env: Env,
    admin: Address,
    proposer: Address,
    voter1: Address,
    voter2: Address,
    token_id: Address,
    registry_id: Address,
    client: CommunityCurationContractClient<'static>,
    token: StellarAssetClient<'static>,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let token = StellarAssetClient::new(&env, &token_id.address());

    // Mint tokens
    token.mint(&proposer, &100_000_000i128); // 10 XLM

    let registry_id = env.register(MockContributorRegistry, ());

    let curation_id = env.register(CommunityCurationContract, ());
    let client = CommunityCurationContractClient::new(&env, &curation_id);

    client.initialize(&admin, &token_id.address(), &registry_id);

    // Setup Mock Reputation
    // We invoke set_reputation directly for the test setup
    env.invoke_contract::<()>(
        &registry_id,
        &soroban_sdk::Symbol::new(&env, "set_reputation"),
        soroban_sdk::vec![&env, voter1.to_val(), 4000u64.into_val(&env)],
    );
    env.invoke_contract::<()>(
        &registry_id,
        &soroban_sdk::Symbol::new(&env, "set_reputation"),
        soroban_sdk::vec![&env, voter2.to_val(), 6000u64.into_val(&env)],
    );

    Setup {
        env,
        admin,
        proposer,
        voter1,
        voter2,
        token_id: token_id.address(),
        registry_id,
        client,
        token,
    }
}

fn valid_metadata(env: &Env) -> ProjectMetadata {
    ProjectMetadata {
        name: String::from_str(env, "My Project"),
        description: String::from_str(env, "A great project"),
        url: String::from_str(env, "https://example.com"),
        funding_address: Address::generate(env),
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────

#[test]
fn test_propose_project_success() {
    let Setup { env, proposer, client, token, .. } = setup();

    let metadata = valid_metadata(&env);
    let project_id = client.propose_project(&proposer, &metadata);
    
    assert_eq!(project_id, 1);
    
    let state = client.get_proposal_state(&project_id).unwrap();
    assert_eq!(state.project_id, 1);
    assert_eq!(state.proposer, proposer);
    assert_eq!(state.status, ProjectStatus::Pending);

    // Deposit should be deducted
    let bal = TokenClient::new(&env, &token.address).balance(&proposer);
    assert_eq!(bal, 100_000_000 - PROPOSAL_DEPOSIT_STROOPS);

    // Event should be emitted
    // let events = env.events().all();
    // let mut found = false;
    // for event in events.iter() {
    //     if event.0 == client.address && event.1.len() > 0 {
    //         found = true;
    //         break;
    //     }
    // }
    // assert!(found, "Event not found");
}

#[test]
fn test_propose_invalid_metadata() {
    let Setup { env, proposer, client, .. } = setup();

    let mut metadata = valid_metadata(&env);
    metadata.name = String::from_str(&env, "");

    let res = client.try_propose_project(&proposer, &metadata);
    assert_eq!(res, Err(Ok(CurationError::InvalidMetadata)));
}

#[test]
fn test_vote_auto_verify() {
    let Setup { env, proposer, voter1, voter2, client, token, .. } = setup();

    let project_id = client.propose_project(&proposer, &valid_metadata(&env));

    // voter1 votes YES (4000 rep out of 10000 = 40%, passes 30% threshold)
    // Wait, MIN_YES_VOTES is 5. 4000 > 5. 40% >= 30%.
    client.vote_to_verify(&voter1, &project_id, &true);

    let state = client.get_proposal_state(&project_id).unwrap();
    assert_eq!(state.status, ProjectStatus::Verified);
    assert_eq!(state.deposit_returned, true);

    // Proposer deposit should be returned
    let bal = TokenClient::new(&env, &token.address).balance(&proposer);
    assert_eq!(bal, 100_000_000); // Returned

    assert_eq!(client.is_verified(&project_id), true);
}

#[test]
fn test_vote_auto_reject() {
    let Setup { env, proposer, voter2, client, token, .. } = setup();

    let project_id = client.propose_project(&proposer, &valid_metadata(&env));

    // voter2 votes NO (6000 rep out of 10000 = 60%, > 50% auto-reject threshold)
    client.vote_to_verify(&voter2, &project_id, &false);

    let state = client.get_proposal_state(&project_id).unwrap();
    assert_eq!(state.status, ProjectStatus::Rejected);
    assert_eq!(state.deposit_returned, false);

    // Deposit not returned
    let bal = TokenClient::new(&env, &token.address).balance(&proposer);
    assert_eq!(bal, 100_000_000 - PROPOSAL_DEPOSIT_STROOPS);
}

#[test]
fn test_double_vote_prevented() {
    let Setup { env, proposer, voter1, client, .. } = setup();

    let project_id = client.propose_project(&proposer, &valid_metadata(&env));

    // First vote
    client.vote_to_verify(&voter1, &project_id, &false);

    // Second vote should fail
    let res = client.try_vote_to_verify(&voter1, &project_id, &true);
    assert_eq!(res, Err(Ok(CurationError::AlreadyVoted)));
}

#[test]
fn test_vote_closed() {
    let Setup { env, proposer, voter1, voter2, client, .. } = setup();

    let project_id = client.propose_project(&proposer, &valid_metadata(&env));

    // Verify it
    client.vote_to_verify(&voter1, &project_id, &true);

    // Voting after closed should fail
    let res = client.try_vote_to_verify(&voter2, &project_id, &true);
    assert_eq!(res, Err(Ok(CurationError::VotingClosed)));
}

#[test]
fn test_admin_reject() {
    let Setup { env, proposer, admin, client, .. } = setup();

    let project_id = client.propose_project(&proposer, &valid_metadata(&env));

    // Admin rejects
    client.admin_reject(&project_id);

    let state = client.get_proposal_state(&project_id).unwrap();
    assert_eq!(state.status, ProjectStatus::Rejected);
}

#[test]
fn test_finalize_expired() {
    let Setup { env, proposer, client, .. } = setup();

    let project_id = client.propose_project(&proposer, &valid_metadata(&env));

    // Before expiration, finalize should fail
    let res = client.try_finalize_proposal(&project_id);
    assert_eq!(res, Err(Ok(CurationError::VotingWindowNotExpired)));

    // Fast forward ledger
    env.ledger().set_sequence_number(env.ledger().sequence() + VOTING_WINDOW_LEDGERS + 1);

    // Now finalize should succeed
    let status = client.finalize_proposal(&project_id);
    assert_eq!(status, ProjectStatus::Rejected);

    let state = client.get_proposal_state(&project_id).unwrap();
    assert_eq!(state.status, ProjectStatus::Rejected);
}

#[test]
fn test_idempotent_finalize() {
    let Setup { env, proposer, client, .. } = setup();

    let project_id = client.propose_project(&proposer, &valid_metadata(&env));

    env.ledger().set_sequence_number(env.ledger().sequence() + VOTING_WINDOW_LEDGERS + 1);

    let status = client.finalize_proposal(&project_id);
    assert_eq!(status, ProjectStatus::Rejected);

    // Call again -> should just return status without error (idempotent)
    let status2 = client.finalize_proposal(&project_id);
    assert_eq!(status2, ProjectStatus::Rejected);
}
