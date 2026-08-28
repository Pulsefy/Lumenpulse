#![cfg(test)]
extern crate std;

use crate::{
    CommunityCurationContract, CommunityCurationContractClient, CurationError, ProjectMetadata,
    ProjectStatus,
};
use crate::events::{ProjectProposedEvent, ProjectVerifiedEvent, VoteCastEvent};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Events, Ledger},
    Address, Env, IntoVal, String,
};

#[contract]
struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
}

#[contract]
struct MockRegistry;

#[contractimpl]
impl MockRegistry {
    pub fn get_reputation(_env: Env, _address: Address) -> u64 {
        10
    }

    pub fn total_reputation(_env: Env) -> u64 {
        10
    }
}

fn setup(env: &Env) -> (CommunityCurationContractClient<'_>, Address, Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let proposer = Address::generate(env);
    let voter = Address::generate(env);
    let token_id = env.register(MockToken, ());
    let registry_id = env.register(MockRegistry, ());
    let contract_id = env.register(CommunityCurationContract, ());
    let client = CommunityCurationContractClient::new(env, &contract_id);
    client.initialize(&admin, &token_id, &registry_id);
    (client, admin, proposer, voter)
}

fn metadata(env: &Env, funding_address: &Address) -> ProjectMetadata {
    ProjectMetadata {
        name: String::from_str(env, "Open Source Fund"),
        description: String::from_str(env, "A useful public project"),
        url: String::from_str(env, "ipfs://project"),
        funding_address: funding_address.clone(),
    }
}

#[test]
fn initialization_is_one_time_only() {
    let env = Env::default();
    let (client, admin, _, _) = setup(&env);
    let token_id = Address::generate(&env);
    let registry_id = Address::generate(&env);

    assert_eq!(
        client.try_initialize(&admin, &token_id, &registry_id),
        Err(Ok(CurationError::AlreadyInitialized))
    );
}

#[test]
fn proposal_starts_pending_and_emits_payload() {
    let env = Env::default();
    let (client, _, proposer, _) = setup(&env);
    let project_id = client.propose_project(&proposer, &metadata(&env, &proposer));

    let proposal = client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.status, ProjectStatus::Pending);
    assert_eq!(proposal.project_id, project_id);
    assert_eq!(proposal.proposer, proposer);
    assert_eq!(proposal.metadata.name, String::from_str(&env, "Open Source Fund"));
    let event = env.events().all().get(0).unwrap();
    assert_eq!(
        event.2,
        ProjectProposedEvent {
            project_id,
            proposer,
            name: soroban_sdk::Symbol::new(&env, "Open Source Fund"),
        }
        .into_val(&env)
    );
}

#[test]
fn yes_vote_verifies_and_returns_deposit() {
    let env = Env::default();
    let (client, _, proposer, voter) = setup(&env);
    let project_id = client.propose_project(&proposer, &metadata(&env, &proposer));

    client.vote_to_verify(&voter, &project_id, &true);

    let proposal = client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.status, ProjectStatus::Verified);
    assert_eq!(proposal.yes_votes, 10);
    assert!(proposal.deposit_returned);
    assert!(client.get_vote(&project_id, &voter).unwrap().approve);
    let events = env.events().all();
    assert_eq!(events.len(), 3);
    assert_eq!(
        events.get(1).unwrap().2,
        VoteCastEvent {
            project_id,
            voter: voter.clone(),
            approve: true,
            voting_power: 10,
        }
        .into_val(&env)
    );
    assert_eq!(events.get(2).unwrap().2, ProjectVerifiedEvent { project_id }.into_val(&env));
    assert!(client.is_verified(&project_id));
}

#[test]
fn no_vote_rejects_and_closes_voting() {
    let env = Env::default();
    let (client, _, proposer, voter) = setup(&env);
    let project_id = client.propose_project(&proposer, &metadata(&env, &proposer));

    client.vote_to_verify(&voter, &project_id, &false);

    let proposal = client.get_proposal_state(&project_id).unwrap();
    assert_eq!(proposal.status, ProjectStatus::Rejected);
    assert_eq!(proposal.no_votes, 10);
    assert!(!proposal.deposit_returned);
    assert_eq!(env.events().all().len(), 3);
    assert_eq!(client.try_finalize_proposal(&project_id), Ok(Ok(ProjectStatus::Rejected)));
}

#[test]
fn expiry_rejects_pending_proposal_and_is_idempotent() {
    let env = Env::default();
    let (client, _, proposer, _) = setup(&env);
    let project_id = client.propose_project(&proposer, &metadata(&env, &proposer));
    let end = client.get_proposal_state(&project_id).unwrap().voting_ends_ledger;

    assert_eq!(client.try_finalize_proposal(&project_id), Err(Ok(CurationError::VotingWindowNotExpired)));
    env.ledger().set_sequence_number(end + 1);
    assert_eq!(client.finalize_proposal(&project_id), ProjectStatus::Rejected);
    assert_eq!(client.finalize_proposal(&project_id), ProjectStatus::Rejected);
    assert_eq!(env.events().all().len(), 2);
}

#[test]
fn invalid_transitions_and_missing_projects_revert() {
    let env = Env::default();
    let (client, _, proposer, voter) = setup(&env);
    assert_eq!(client.try_vote_to_verify(&voter, &99, &true), Err(Ok(CurationError::ProjectNotFound)));
    assert_eq!(client.try_finalize_proposal(&99), Err(Ok(CurationError::ProjectNotFound)));

    let project_id = client.propose_project(&proposer, &metadata(&env, &proposer));
    client.vote_to_verify(&voter, &project_id, &true);
    assert_eq!(client.try_vote_to_verify(&voter, &project_id, &true), Err(Ok(CurationError::VotingClosed)));
    assert_eq!(client.try_admin_reject(&project_id), Err(Ok(CurationError::VotingClosed)));
}

#[test]
fn admin_rejects_pending_proposal() {
    let env = Env::default();
    let (client, _, proposer, _) = setup(&env);
    let project_id = client.propose_project(&proposer, &metadata(&env, &proposer));

    client.admin_reject(&project_id);

    assert_eq!(client.get_proposal_state(&project_id).unwrap().status, ProjectStatus::Rejected);
    assert_eq!(env.events().all().len(), 2);
}

#[test]
fn invalid_metadata_is_rejected_before_transfer() {
    let env = Env::default();
    let (client, _, proposer, _) = setup(&env);
    let mut invalid = metadata(&env, &proposer);
    invalid.name = String::from_str(&env, "");
    assert_eq!(client.try_propose_project(&proposer, &invalid), Err(Ok(CurationError::InvalidMetadata)));
}