extern crate std;

use crate::{
    multisig::{ProposalAction, Signer},
    storage::{AttestationStatus, Badge, ContribPauseScope, PenaltySeverity},
    ContributorRegistryContract, ContributorRegistryContractClient,
};
use notification_interface::Notification;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Bytes, Env, String, Symbol, Vec,
};

fn record(env: &Env, entrypoint: &str) {
    let resources = env.cost_estimate().resources();
    std::println!(
        "SOROBAN_COST_BENCHMARK {{\"contract\":\"contributor_registry\",\"entrypoint\":\"{entrypoint}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}",
        resources.instructions,
        resources.memory_read_entries + resources.disk_read_entries,
        resources.write_entries,
    );
}

fn approved(
    client: &ContributorRegistryContractClient,
    proposer: &Address,
    signer: &Address,
    action: &ProposalAction,
) -> u64 {
    let id = client.propose(proposer, action);
    client.sign(signer, &id);
    id
}

#[test]
fn successful_entrypoint_costs() {
    let env = Env::default();
    env.mock_all_auths();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let contract = env.register(ContributorRegistryContract, ());
    let client = ContributorRegistryContractClient::new(&env, &contract);
    let mut signers = Vec::new(&env);
    signers.push_back(Signer {
        address: alice.clone(),
        weight: 1,
    });
    signers.push_back(Signer {
        address: bob.clone(),
        weight: 1,
    });
    client.initialize(&signers, &2);
    record(&env, "initialize");

    let primary = Address::generate(&env);
    client.register_contributor(&primary, &String::from_str(&env, "benchmark_primary"));
    record(&env, "register_contributor");
    let signed_user = Address::generate(&env);
    client.register_contributor_with_sig(
        &String::from_str(&env, "benchmark_signed"),
        &signed_user,
        &Bytes::from_slice(&env, &[1, 2, 3]),
    );
    record(&env, "register_contributor_with_sig");

    client.update_contributor(
        &primary,
        &primary,
        &String::from_str(&env, "benchmark_updated"),
        &None,
    );
    record(&env, "update_contributor");

    let proposal = client.propose(&alice, &ProposalAction::SetAdmin);
    record(&env, "propose");
    client.sign(&bob, &proposal);
    record(&env, "sign");

    let cancel_id = client.propose(&alice, &ProposalAction::Upgrade);
    client.cancel_proposal(&alice, &cancel_id);
    record(&env, "cancel_proposal");

    let config_id = approved(&client, &alice, &bob, &ProposalAction::SetAdmin);
    client.set_multisig_config(&alice, &config_id, &signers, &2);
    record(&env, "set_multisig_config");

    let rep_id = approved(&client, &alice, &bob, &ProposalAction::UpdateReputation);
    client.update_reputation(&alice, &rep_id, &primary, &100);
    record(&env, "update_reputation");

    let grant_id = approved(&client, &alice, &bob, &ProposalAction::GrantBadge);
    client.grant_badge(&alice, &grant_id, &primary, &Badge::EarlyAdopter);
    record(&env, "grant_badge");
    let revoke_badge_id = approved(&client, &alice, &bob, &ProposalAction::RevokeBadge);
    client.revoke_badge(&alice, &revoke_badge_id, &primary, &Badge::EarlyAdopter);
    record(&env, "revoke_badge");

    let penalty_id = approved(&client, &alice, &bob, &ProposalAction::ApplyPenalty);
    client.apply_reputation_penalty(
        &alice,
        &penalty_id,
        &primary,
        &7,
        &PenaltySeverity::Minor,
        &5,
        &String::from_str(&env, "benchmark penalty"),
    );
    record(&env, "apply_reputation_penalty");

    let suspend_id = approved(&client, &alice, &bob, &ProposalAction::SuspendAttestation);
    client.suspend_attestation(&alice, &suspend_id, &primary);
    record(&env, "suspend_attestation");
    let restore_id = approved(&client, &alice, &bob, &ProposalAction::RestoreAttestation);
    client.restore_attestation(&alice, &restore_id, &primary);
    record(&env, "restore_attestation");
    let revoked_user = Address::generate(&env);
    client.register_contributor(&revoked_user, &String::from_str(&env, "benchmark_revoked"));
    let revoke_id = approved(&client, &alice, &bob, &ProposalAction::RevokeAttestation);
    client.revoke_attestation(&alice, &revoke_id, &revoked_user);
    record(&env, "revoke_attestation");

    let admin_id = approved(&client, &alice, &bob, &ProposalAction::SetAdmin);
    let new_admin = Address::generate(&env);
    client.set_admin(&alice, &admin_id, &new_admin);
    record(&env, "set_admin");

    client.pause_scope(&alice, &ContribPauseScope::Contribution);
    record(&env, "pause_scope");
    assert!(client.is_paused(&ContribPauseScope::Contribution));
    record(&env, "is_paused");
    client.unpause_scope(&alice, &ContribPauseScope::Contribution);
    record(&env, "unpause_scope");

    let nonce_user = Address::generate(&env);
    assert_eq!(client.get_registration_nonce(&signed_user), 1);
    record(&env, "get_registration_nonce");
    assert_eq!(client.get_reputation(&primary), 95);
    record(&env, "get_reputation");
    assert_eq!(
        client.get_attestation_status(&primary),
        AttestationStatus::Active
    );
    record(&env, "get_attestation_status");
    client.get_tier(&primary);
    record(&env, "get_tier");
    client.get_badges(&primary);
    record(&env, "get_badges");
    assert!(client.get_penalty_record(&primary).is_some());
    record(&env, "get_penalty_record");
    assert_eq!(client.get_contributor(&primary).address, primary);
    record(&env, "get_contributor");
    assert_eq!(
        client
            .get_contributor_by_github(&String::from_str(&env, "benchmark_updated"))
            .address,
        primary
    );
    record(&env, "get_contributor_by_github");
    client.get_multisig_config();
    record(&env, "get_multisig_config");
    client.get_proposal(&proposal);
    record(&env, "get_proposal");
    client.get_next_proposal_id();
    record(&env, "get_next_proposal_id");
    let _ = client.contract_version();
    record(&env, "contract_version");
    client.on_notify(&Notification {
        source: alice.clone(),
        event_type: Symbol::new(&env, "benchmark"),
        data: Bytes::new(&env),
    });
    record(&env, "on_notify");

    let expiring = client.propose(&alice, &ProposalAction::Upgrade);
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + 72 * 60 * 60 + 1);
    client.expire_proposal(&expiring);
    record(&env, "expire_proposal");

    client.deregister_contributor(&revoked_user);
    record(&env, "deregister_contributor");

    let upgrade_id = approved(&client, &alice, &bob, &ProposalAction::Upgrade);
    let wasm = Bytes::from_slice(
        &env,
        include_bytes!("../../upgradable-contract/src/mock/upgradable_contract.wasm"),
    );
    let wasm_hash = env.deployer().upload_contract_wasm(wasm);
    client.upgrade(&alice, &upgrade_id, &wasm_hash);
    record(&env, "upgrade");

    let _ = nonce_user;
}
