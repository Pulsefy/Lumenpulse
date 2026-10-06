extern crate std;

use crate::{storage::MilestoneLink, VestingWalletContract, VestingWalletContractClient};
use crowdfund_vault::{CrowdfundVaultContract, CrowdfundVaultContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Bytes, Env, Symbol,
};

fn record(env: &Env, name: &str) {
    let r = env.cost_estimate().resources();
    std::println!("SOROBAN_COST_BENCHMARK {{\"contract\":\"vesting-wallet\",\"entrypoint\":\"{name}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}",r.instructions,r.memory_read_entries+r.disk_read_entries,r.write_entries);
}
macro_rules! bench {
    ($env:expr,$name:literal,$call:expr) => {{
        let value = $call;
        record($env, $name);
        value
    }};
}

#[test]
fn successful_entrypoint_costs() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);
    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let delegate = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone());
    let token_admin = StellarAssetClient::new(&env, &token.address());
    token_admin.mint(&admin, &1_000_000);
    let id = env.register(VestingWalletContract, ());
    let c = VestingWalletContractClient::new(&env, &id);
    bench!(&env, "initialize", c.initialize(&admin, &token.address()));
    bench!(
        &env,
        "create_vesting",
        c.create_vesting(&admin, &beneficiary, &100, &1_000, &10_000)
    );
    bench!(&env, "get_claimable", c.get_claimable(&beneficiary));
    bench!(&env, "get_vesting", c.get_vesting(&beneficiary));
    bench!(
        &env,
        "get_available_amount",
        c.get_available_amount(&beneficiary)
    );
    bench!(&env, "get_admin", c.get_admin());
    bench!(&env, "get_token", c.get_token());
    bench!(
        &env,
        "approve_delegate",
        c.approve_delegate(&beneficiary, &delegate)
    );
    bench!(&env, "get_delegates", c.get_delegates(&beneficiary));
    bench!(
        &env,
        "revoke_delegate",
        c.revoke_delegate(&beneficiary, &delegate)
    );
    c.approve_delegate(&beneficiary, &delegate);
    let second = Address::generate(&env);
    c.create_vesting(&admin, &second, &200, &1_000, &10_000);
    c.approve_delegate(&second, &delegate);
    env.ledger().set_timestamp(6_000);
    bench!(&env, "claim_for", c.claim_for(&delegate, &second));
    bench!(&env, "claim", c.claim(&beneficiary));

    let vault_admin = Address::generate(&env);
    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = CrowdfundVaultContractClient::new(&env, &vault_id);
    vault.initialize(&vault_admin);
    let owner = Address::generate(&env);
    let project = vault.create_project(
        &owner,
        &Symbol::new(&env, "Bench"),
        &1_000,
        &token.address(),
    );
    let third = Address::generate(&env);
    let link = MilestoneLink {
        vault_contract: vault_id,
        project_id: project,
        milestone_id: 0,
    };
    bench!(
        &env,
        "create_vesting_with_milestone",
        c.create_vesting_with_milestone(&admin, &third, &50, &6_000, &10_000, &link)
    );
    bench!(&env, "contract_version", c.contract_version());
    let new_admin = Address::generate(&env);
    bench!(&env, "set_admin", c.set_admin(&admin, &new_admin));
    let wasm = env.deployer().upload_contract_wasm(Bytes::from_slice(
        &env,
        include_bytes!("../../upgradable-contract/src/mock/upgradable_contract.wasm"),
    ));
    bench!(&env, "upgrade", c.upgrade(&new_admin, &wasm));
}
