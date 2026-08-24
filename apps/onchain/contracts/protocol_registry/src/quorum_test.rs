//! Tests for multi-admin quorum execution of privileged registry actions.
//!
//! Two things need proving: a proposal that collects enough weight executes,
//! and every way execution should be refused actually is (not enough weight,
//! double-signing, non-signers, mismatched parameters, reuse, expiry).

use crate::errors::RegistryError;
use crate::{
    ModuleProposal, ProposalStatus, ProtocolRegistryContract, ProtocolRegistryContractClient,
    RegistryAction, Signer, PROPOSAL_TTL_SECS,
};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger as _},
    vec, Address, Env, Vec,
};

fn setup(env: &Env) -> (ProtocolRegistryContractClient<'_>, Address) {
    let admin = Address::generate(env);
    let id = env.register(ProtocolRegistryContract, ());
    let client = ProtocolRegistryContractClient::new(env, &id);
    client.initialize(&admin);
    (client, admin)
}

/// Three weight-1 signers.
fn signer_set(env: &Env) -> (Vec<Signer>, Address, Address, Address) {
    let a = Address::generate(env);
    let b = Address::generate(env);
    let c = Address::generate(env);
    let signers = vec![
        env,
        Signer {
            address: a.clone(),
            weight: 1,
        },
        Signer {
            address: b.clone(),
            weight: 1,
        },
        Signer {
            address: c.clone(),
            weight: 1,
        },
    ];
    (signers, a, b, c)
}

fn register_action(addr: &Address, version: u32) -> RegistryAction {
    RegistryAction::RegisterModule(ModuleProposal {
        name: symbol_short!("vault"),
        address: addr.clone(),
        version,
    })
}

// ── Configuration ────────────────────────────────────────────────────────────

#[test]
fn test_configure_quorum_stores_policy() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, _a, _b, _c) = signer_set(&env);

    client.configure_quorum(&signers, &2u32);

    let config = client.get_quorum_config();
    assert_eq!(config.threshold, 2);
    assert_eq!(config.signers.len(), 3);
    assert_eq!(client.get_next_proposal_id(), 0);
}

#[test]
fn test_configure_quorum_rejects_unreachable_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, _a, _b, _c) = signer_set(&env);

    // Total weight is 3; a threshold of 4 could never be met and would
    // permanently deadlock every gated action.
    assert_eq!(
        client.try_configure_quorum(&signers, &4u32),
        Err(Ok(RegistryError::InvalidQuorumConfig))
    );
    assert_eq!(
        client.try_configure_quorum(&signers, &0u32),
        Err(Ok(RegistryError::InvalidQuorumConfig))
    );
}

#[test]
fn test_configure_quorum_twice_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, _a, _b, _c) = signer_set(&env);

    client.configure_quorum(&signers, &2u32);
    assert_eq!(
        client.try_configure_quorum(&signers, &1u32),
        Err(Ok(RegistryError::QuorumAlreadyConfigured))
    );
}

#[test]
fn test_gated_action_before_configuration_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let caller = Address::generate(&env);
    let target = Address::generate(&env);

    assert_eq!(
        client.try_register_module_via_quorum(
            &caller,
            &0u64,
            &symbol_short!("vault"),
            &target,
            &1u32
        ),
        Err(Ok(RegistryError::QuorumNotConfigured))
    );
}

// ── Happy path ───────────────────────────────────────────────────────────────

#[test]
fn test_quorum_register_module_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, a, b, _c) = signer_set(&env);
    client.configure_quorum(&signers, &2u32);

    let target = Address::generate(&env);

    // The proposer's own weight counts, but 1 < threshold 2.
    let id = client.propose_action(&a, &register_action(&target, 1));
    let proposal = client.get_proposal(&id);
    assert_eq!(proposal.status, ProposalStatus::Pending);
    assert_eq!(proposal.weight_collected, 1);

    // The second approval crosses the threshold.
    assert_eq!(client.sign_proposal(&b, &id), ProposalStatus::Approved);

    client.register_module_via_quorum(&a, &id, &symbol_short!("vault"), &target, &1u32);

    let entry = client.get_module(&symbol_short!("vault"));
    assert_eq!(entry.address, target);
    assert_eq!(entry.version, 1);
    assert!(entry.is_active);
    assert_eq!(client.resolve(&symbol_short!("vault")), target);
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Executed);
    assert_eq!(client.get_next_proposal_id(), 1);
}

#[test]
fn test_weighted_signer_can_meet_threshold_alone() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let heavy = Address::generate(&env);
    let light = Address::generate(&env);
    let signers = vec![
        &env,
        Signer {
            address: heavy.clone(),
            weight: 3,
        },
        Signer {
            address: light.clone(),
            weight: 1,
        },
    ];
    client.configure_quorum(&signers, &3u32);

    let target = Address::generate(&env);
    let id = client.propose_action(&heavy, &register_action(&target, 1));

    // Weight, not headcount, decides approval.
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Approved);
    client.register_module_via_quorum(&heavy, &id, &symbol_short!("vault"), &target, &1u32);
    assert!(client.is_active(&symbol_short!("vault")));
}

#[test]
fn test_update_and_deactivate_via_quorum() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, a, b, _c) = signer_set(&env);
    client.configure_quorum(&signers, &2u32);

    let v1 = Address::generate(&env);
    let id = client.propose_action(&a, &register_action(&v1, 1));
    client.sign_proposal(&b, &id);
    client.register_module_via_quorum(&a, &id, &symbol_short!("vault"), &v1, &1u32);

    // Upgrade to v2.
    let v2 = Address::generate(&env);
    let upgrade = RegistryAction::UpdateModule(ModuleProposal {
        name: symbol_short!("vault"),
        address: v2.clone(),
        version: 2,
    });
    let id2 = client.propose_action(&a, &upgrade);
    client.sign_proposal(&b, &id2);
    client.update_module_via_quorum(&a, &id2, &symbol_short!("vault"), &v2, &2u32);
    assert_eq!(client.resolve(&symbol_short!("vault")), v2);

    // Deactivate.
    let id3 = client.propose_action(
        &a,
        &RegistryAction::DeactivateModule(symbol_short!("vault")),
    );
    client.sign_proposal(&b, &id3);
    client.deactivate_module_via_quorum(&a, &id3, &symbol_short!("vault"));
    assert!(!client.is_active(&symbol_short!("vault")));
    assert_eq!(
        client.try_resolve(&symbol_short!("vault")),
        Err(Ok(RegistryError::ModuleInactive))
    );
}

#[test]
fn test_set_admin_via_quorum() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let (signers, a, b, _c) = signer_set(&env);
    client.configure_quorum(&signers, &2u32);

    let new_admin = Address::generate(&env);
    let id = client.propose_action(&a, &RegistryAction::SetAdmin(new_admin.clone()));
    client.sign_proposal(&b, &id);

    assert_eq!(client.get_admin(), admin);
    client.set_admin_via_quorum(&a, &id, &new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn test_threshold_change_requires_approved_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, a, b, _c) = signer_set(&env);
    client.configure_quorum(&signers, &2u32);

    let id = client.propose_action(&a, &RegistryAction::SetQuorumConfig);
    client.sign_proposal(&b, &id);
    client.set_quorum_config(&a, &id, &signers, &3u32);

    assert_eq!(client.get_quorum_config().threshold, 3);
}

#[test]
fn test_admin_approval_cannot_be_redirected_into_config_takeover() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, a, b, _c) = signer_set(&env);
    client.configure_quorum(&signers, &2u32);

    // Signers approved an admin rotation, not a signer-set replacement.
    let attacker = Address::generate(&env);
    let id = client.propose_action(&a, &RegistryAction::SetAdmin(attacker.clone()));
    client.sign_proposal(&b, &id);

    let solo = vec![
        &env,
        Signer {
            address: attacker.clone(),
            weight: 1,
        },
    ];
    assert_eq!(
        client.try_set_quorum_config(&a, &id, &solo, &1u32),
        Err(Ok(RegistryError::WrongProposalAction))
    );
    assert_eq!(client.get_quorum_config().signers.len(), 3);
}

// ── Refusals ─────────────────────────────────────────────────────────────────

#[test]
fn test_insufficient_quorum_cannot_execute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, a, _b, _c) = signer_set(&env);
    client.configure_quorum(&signers, &3u32);

    let target = Address::generate(&env);
    let id = client.propose_action(&a, &register_action(&target, 1));

    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Pending);
    assert_eq!(
        client.try_register_module_via_quorum(
            &a,
            &id,
            &symbol_short!("vault"),
            &target,
            &1u32
        ),
        Err(Ok(RegistryError::ProposalNotApproved))
    );
    assert_eq!(
        client.try_get_module(&symbol_short!("vault")),
        Err(Ok(RegistryError::ModuleNotFound))
    );
}

#[test]
fn test_duplicate_approval_does_not_reach_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, a, _b, _c) = signer_set(&env);
    client.configure_quorum(&signers, &2u32);

    let target = Address::generate(&env);
    let id = client.propose_action(&a, &register_action(&target, 1));

    // The proposer already counted; signing again must not add weight.
    assert_eq!(
        client.try_sign_proposal(&a, &id),
        Err(Ok(RegistryError::ProposalAlreadySigned))
    );

    let proposal = client.get_proposal(&id);
    assert_eq!(proposal.weight_collected, 1);
    assert_eq!(proposal.status, ProposalStatus::Pending);
}

#[test]
fn test_non_signer_cannot_propose_sign_or_execute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, a, b, _c) = signer_set(&env);
    client.configure_quorum(&signers, &2u32);

    let outsider = Address::generate(&env);
    let target = Address::generate(&env);
    let action = register_action(&target, 1);

    assert_eq!(
        client.try_propose_action(&outsider, &action),
        Err(Ok(RegistryError::Unauthorized))
    );

    let id = client.propose_action(&a, &action);
    assert_eq!(
        client.try_sign_proposal(&outsider, &id),
        Err(Ok(RegistryError::Unauthorized))
    );

    client.sign_proposal(&b, &id);
    assert_eq!(
        client.try_register_module_via_quorum(
            &outsider,
            &id,
            &symbol_short!("vault"),
            &target,
            &1u32
        ),
        Err(Ok(RegistryError::Unauthorized))
    );
}

#[test]
fn test_execution_must_match_approved_parameters() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, a, b, _c) = signer_set(&env);
    client.configure_quorum(&signers, &2u32);

    let approved = Address::generate(&env);
    let id = client.propose_action(&a, &register_action(&approved, 1));
    client.sign_proposal(&b, &id);

    // Swapping the address the signers approved must fail.
    let sneaky = Address::generate(&env);
    assert_eq!(
        client.try_register_module_via_quorum(
            &a,
            &id,
            &symbol_short!("vault"),
            &sneaky,
            &1u32
        ),
        Err(Ok(RegistryError::WrongProposalAction))
    );

    // So must changing the version or the module name.
    assert_eq!(
        client.try_register_module_via_quorum(
            &a,
            &id,
            &symbol_short!("vault"),
            &approved,
            &9u32
        ),
        Err(Ok(RegistryError::WrongProposalAction))
    );
    assert_eq!(
        client.try_register_module_via_quorum(
            &a,
            &id,
            &symbol_short!("other"),
            &approved,
            &1u32
        ),
        Err(Ok(RegistryError::WrongProposalAction))
    );

    // The untouched proposal still executes on its approved parameters.
    client.register_module_via_quorum(&a, &id, &symbol_short!("vault"), &approved, &1u32);
    assert_eq!(client.resolve(&symbol_short!("vault")), approved);
}

#[test]
fn test_approval_cannot_be_reused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, a, b, _c) = signer_set(&env);
    client.configure_quorum(&signers, &2u32);

    let target = Address::generate(&env);
    let id = client.propose_action(&a, &register_action(&target, 1));
    client.sign_proposal(&b, &id);
    client.register_module_via_quorum(&a, &id, &symbol_short!("vault"), &target, &1u32);

    // Second execution of the same approval is refused.
    assert_eq!(
        client.try_register_module_via_quorum(
            &a,
            &id,
            &symbol_short!("vault"),
            &target,
            &1u32
        ),
        Err(Ok(RegistryError::ProposalNotActive))
    );
}

#[test]
fn test_expired_proposal_cannot_execute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, a, b, _c) = signer_set(&env);
    client.configure_quorum(&signers, &2u32);

    let target = Address::generate(&env);
    let id = client.propose_action(&a, &register_action(&target, 1));
    client.sign_proposal(&b, &id);

    env.ledger().set_timestamp(PROPOSAL_TTL_SECS + 1);

    assert_eq!(
        client.try_register_module_via_quorum(
            &a,
            &id,
            &symbol_short!("vault"),
            &target,
            &1u32
        ),
        Err(Ok(RegistryError::ProposalExpired))
    );

    // Expiry can be recorded permissionlessly, and is then terminal.
    client.expire_proposal(&id);
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Expired);
    assert_eq!(
        client.try_expire_proposal(&id),
        Err(Ok(RegistryError::ProposalNotActive))
    );
}

#[test]
fn test_cannot_expire_a_live_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, a, _b, _c) = signer_set(&env);
    client.configure_quorum(&signers, &2u32);

    let target = Address::generate(&env);
    let id = client.propose_action(&a, &register_action(&target, 1));

    assert_eq!(
        client.try_expire_proposal(&id),
        Err(Ok(RegistryError::ProposalNotActive))
    );
}

#[test]
fn test_cancelled_proposal_cannot_execute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, a, b, c) = signer_set(&env);
    client.configure_quorum(&signers, &2u32);

    let target = Address::generate(&env);
    let id = client.propose_action(&a, &register_action(&target, 1));
    client.sign_proposal(&b, &id);

    // Any signer may cancel, including one who did not approve.
    client.cancel_proposal(&c, &id);
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Cancelled);

    assert_eq!(
        client.try_register_module_via_quorum(
            &a,
            &id,
            &symbol_short!("vault"),
            &target,
            &1u32
        ),
        Err(Ok(RegistryError::ProposalNotActive))
    );
    assert_eq!(
        client.try_sign_proposal(&c, &id),
        Err(Ok(RegistryError::ProposalNotActive))
    );
}

#[test]
fn test_unknown_proposal_id_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let (signers, a, _b, _c) = signer_set(&env);
    client.configure_quorum(&signers, &2u32);

    assert_eq!(
        client.try_get_proposal(&42u64),
        Err(Ok(RegistryError::ProposalNotFound))
    );
    assert_eq!(
        client.try_sign_proposal(&a, &42u64),
        Err(Ok(RegistryError::ProposalNotFound))
    );
}
