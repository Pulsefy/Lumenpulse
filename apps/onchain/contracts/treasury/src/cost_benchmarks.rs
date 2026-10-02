extern crate std;

use crate::{
    storage::{DataKey, Proposal, ProposalAction, ProposalStatus, Signer},
    TreasuryContract, TreasuryContractClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    vec, Address, BytesN, Env, String,
};

fn record(env: &Env, name: &str) {
    let r = env.cost_estimate().resources();
    std::println!("SOROBAN_COST_BENCHMARK {{\"contract\":\"treasury\",\"entrypoint\":\"{name}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}",r.instructions,r.memory_read_entries+r.disk_read_entries,r.write_entries);
}
macro_rules! bench {
    ($e:expr,$n:literal,$call:expr) => {{
        let v = $call;
        record($e, $n);
        v
    }};
}
fn req(env: &Env, n: u8) -> BytesN<32> {
    let mut a = [0; 32];
    a[31] = n;
    BytesN::from_array(env, &a)
}
fn seed_proposal(
    env: &Env,
    id: &Address,
    pid: u64,
    action: ProposalAction,
    proposer: &Address,
    status: ProposalStatus,
    expires: u64,
) {
    let p = Proposal {
        id: pid,
        action,
        proposer: proposer.clone(),
        created_at: 0,
        expires_at: expires,
        status,
        signers: vec![env, proposer.clone()],
        weight_collected: 2,
    };
    env.as_contract(id, || {
        env.storage().instance().set(&DataKey::Proposal(pid), &p);
    });
}

#[test]
fn successful_entrypoint_costs() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);
    let admin = Address::generate(&env);
    let s2 = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let b2 = Address::generate(&env);
    let b3 = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone());
    let ta = StellarAssetClient::new(&env, &token.address());
    ta.mint(&admin, &100_000);
    let id = env.register(TreasuryContract, ());
    let c = TreasuryContractClient::new(&env, &id);
    bench!(&env, "initialize", c.initialize(&admin, &token.address()));
    let signers = vec![
        &env,
        Signer {
            address: admin.clone(),
            weight: 1,
        },
        Signer {
            address: s2.clone(),
            weight: 1,
        },
    ];
    bench!(
        &env,
        "configure_multisig",
        c.configure_multisig(&signers, &2)
    );
    bench!(&env, "get_multisig_config", c.get_multisig_config());
    let pid = bench!(
        &env,
        "propose",
        c.propose(&admin, &ProposalAction::SetAdmin)
    );
    bench!(&env, "sign_proposal", c.sign_proposal(&s2, &pid));
    bench!(&env, "get_proposal", c.get_proposal(&pid));
    bench!(&env, "get_next_proposal_id", c.get_next_proposal_id());
    bench!(
        &env,
        "allocate_budget",
        c.allocate_budget(&admin, &beneficiary, &1_000, &1_000, &10_000, &req(&env, 1))
    );
    bench!(
        &env,
        "allocate_budget_with_cliff",
        c.allocate_budget_with_cliff(&admin, &b2, &1_000, &1_000, &10_000, &2_000, &req(&env, 2))
    );
    bench!(&env, "get_unlocked", c.get_unlocked(&beneficiary));
    bench!(&env, "get_cliff", c.get_cliff(&b2));
    bench!(&env, "get_admin", c.get_admin());
    bench!(&env, "get_token", c.get_token());
    bench!(&env, "get_financials", c.get_financials());
    bench!(
        &env,
        "preview_unlocked_at",
        c.preview_unlocked_at(&beneficiary, &5_000)
    );
    bench!(
        &env,
        "preview_schedule",
        c.preview_schedule(&beneficiary, &1_000, &3)
    );
    env.ledger().set_timestamp(6_000);
    bench!(&env, "claim", c.claim(&beneficiary));
    bench!(
        &env,
        "rotate_beneficiary",
        c.rotate_beneficiary(&admin, &beneficiary, &Address::generate(&env))
    );
    bench!(&env, "cancel_stream", c.cancel_stream(&admin, &b2));
    c.allocate_budget(&admin, &b3, &500, &6_000, &10_000, &req(&env, 3));
    bench!(
        &env,
        "emergency_stop",
        c.emergency_stop(&admin, &b3, &String::from_str(&env, "benchmark"))
    );

    let b4 = Address::generate(&env);
    c.allocate_budget(&admin, &b4, &500, &6_000, &10_000, &req(&env, 4));
    let new_b = Address::generate(&env);
    seed_proposal(
        &env,
        &id,
        90,
        ProposalAction::RotateBeneficiary,
        &admin,
        ProposalStatus::Approved,
        100_000,
    );
    bench!(
        &env,
        "rotate_beneficiary_via_multisig",
        c.rotate_beneficiary_via_multisig(&admin, &90, &b4, &new_b)
    );
    let replacement = vec![
        &env,
        Signer {
            address: admin.clone(),
            weight: 1,
        },
        Signer {
            address: s2.clone(),
            weight: 1,
        },
    ];
    seed_proposal(
        &env,
        &id,
        91,
        ProposalAction::SetAdmin,
        &admin,
        ProposalStatus::Approved,
        100_000,
    );
    bench!(
        &env,
        "set_multisig_config",
        c.set_multisig_config(&admin, &91, &replacement, &2)
    );
    seed_proposal(
        &env,
        &id,
        92,
        ProposalAction::SetAdmin,
        &admin,
        ProposalStatus::Approved,
        100_000,
    );
    let next_admin = Address::generate(&env);
    bench!(
        &env,
        "set_admin_via_multisig",
        c.set_admin_via_multisig(&admin, &92, &next_admin)
    );

    seed_proposal(
        &env,
        &id,
        93,
        ProposalAction::SetAdmin,
        &admin,
        ProposalStatus::Pending,
        100_000,
    );
    bench!(&env, "cancel_proposal", c.cancel_proposal(&s2, &93));
    seed_proposal(
        &env,
        &id,
        94,
        ProposalAction::SetAdmin,
        &admin,
        ProposalStatus::Pending,
        500,
    );
    bench!(&env, "expire_proposal", c.expire_proposal(&94));
}
