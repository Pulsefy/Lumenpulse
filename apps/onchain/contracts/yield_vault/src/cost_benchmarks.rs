extern crate std;

use crate::{YieldVaultContract, YieldVaultContractClient};
use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, token::StellarAssetClient, Address, BytesN,
    Env, Symbol,
};

#[contract]
struct BenchProvider;
#[contractimpl]
impl BenchProvider {
    pub fn deposit(env: Env, from: Address, amount: i128) -> i128 {
        let n: i128 = env.storage().persistent().get(&from).unwrap_or(0);
        env.storage().persistent().set(&from, &(n + amount));
        amount
    }
    pub fn withdraw(env: Env, to: Address, amount: i128) -> i128 {
        let n: i128 = env.storage().persistent().get(&to).unwrap_or(0);
        env.storage().persistent().set(&to, &(n - amount));
        amount
    }
    pub fn balance(env: Env, who: Address) -> i128 {
        env.storage().persistent().get(&who).unwrap_or(0)
    }
}

fn record(env: &Env, name: &str) {
    let r = env.cost_estimate().resources();
    std::println!("SOROBAN_COST_BENCHMARK {{\"contract\":\"yield_vault\",\"entrypoint\":\"{name}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}", r.instructions, r.memory_read_entries + r.disk_read_entries, r.write_entries);
}
fn req(env: &Env, nonce: u8) -> BytesN<32> {
    let mut b = [0u8; 32];
    b[31] = nonce;
    BytesN::from_array(env, &b)
}

#[test]
fn successful_entrypoint_costs() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone());
    let id = env.register(YieldVaultContract, ());
    let c = YieldVaultContractClient::new(&env, &id);
    c.initialize(&admin, &token.address());
    record(&env, "initialize");
    c.set_paused(&admin, &true);
    record(&env, "set_paused");
    c.is_paused();
    record(&env, "is_paused");
    c.set_paused(&admin, &false);
    let provider = env.register(BenchProvider, ());
    let p = c.register_provider(&admin, &Symbol::new(&env, "bench"), &provider, &10);
    record(&env, "register_provider");
    StellarAssetClient::new(&env, &token.address()).mint(&user, &100_000);
    c.deposit(&1_000, &user, &req(&env, 1));
    record(&env, "deposit");
    c.balance_of(&user);
    record(&env, "balance_of");
    c.get_total_aum();
    record(&env, "get_total_aum");
    c.harvest_yield(&admin, &p);
    record(&env, "harvest_yield");
    c.get_total_yield_harvested();
    record(&env, "get_total_yield_harvested");
    c.get_provider(&p);
    record(&env, "get_provider");
    c.withdraw(&400, &user, &req(&env, 2));
    record(&env, "withdraw");
}
