use crate::yield_provider::YieldProviderTrait;
use crate::{CrowdfundVaultContract, CrowdfundVaultContractClient};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

#[contract]
pub struct MockYieldProvider;

#[contractimpl]
impl MockYieldProvider {
    pub fn initialize(env: Env, token: Address) {
        env.storage()
            .instance()
            .set(&symbol_short!("token"), &token);
    }
}

#[contractimpl]
impl YieldProviderTrait for MockYieldProvider {
    fn deposit(env: Env, from: Address, amount: i128) {
        let _token_addr: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("token"))
            .unwrap();
        // In a real provider, this would transfer tokens FROM the contract to itself
        // but since the vault already transferred them to us in `invest_funds_internal`,
        // we just track the balance.
        let current: i128 = env.storage().persistent().get(&from).unwrap_or(0);
        env.storage().persistent().set(&from, &(current + amount));
    }

    fn withdraw(env: Env, to: Address, amount: i128) {
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("token"))
            .unwrap();
        let token = TokenClient::new(&env, &token_addr);

        let current: i128 = env.storage().persistent().get(&to).unwrap_or(0);
        if current < amount {
            panic!("insufficient balance in mock");
        }

        // Transfer tokens back to the vault
        token.transfer(&env.current_contract_address(), &to, &amount);

        env.storage().persistent().set(&to, &(current - amount));
    }

    fn balance(env: Env, address: Address) -> i128 {
        env.storage().persistent().get(&address).unwrap_or(0)
    }
}

fn setup_yield_test<'a>(
    env: &Env,
) -> (
    CrowdfundVaultContractClient<'a>,
    Address,
    Address,
    Address,
    TokenClient<'a>,
    Address,
) {
    let admin = Address::generate(env);
    let owner = Address::generate(env);
    let user = Address::generate(env);

    // Create token
    let token_admin = Address::generate(env);
    let token_addr = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_client = TokenClient::new(env, &token_addr.address());
    let token_admin_client = StellarAssetClient::new(env, &token_addr.address());

    // Mint tokens to user for deposits
    token_admin_client.mint(&user, &10_000_000);

    // Register vault contract
    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault_client = CrowdfundVaultContractClient::new(env, &vault_id);

    // Register mock yield provider
    let yield_id = env.register(MockYieldProvider, ());
    let mock_yield_client = MockYieldProviderClient::new(env, &yield_id);
    mock_yield_client.initialize(&token_client.address);

    // Give some tokens to the yield provider so it can fulfill withdrawals
    // (In reality it would have the tokens we deposited)
    token_admin_client.mint(&yield_id, &10_000_000);

    (vault_client, admin, owner, user, token_client, yield_id)
}

#[test]
fn test_yield_investment_and_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, owner, user, token_client, yield_id) = setup_yield_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Set yield provider
    client.set_yield_provider(&admin, &token_client.address, &yield_id);

    // Create project
    let project_id = client.create_project(
        &owner,
        &symbol_short!("YieldPrj"),
        &1_000_000,
        &token_client.address,
    );

    // Deposit funds
    client.deposit(&user, &project_id, &500_000);

    // Invest idle funds
    client.invest_idle_funds(&owner, &project_id, &300_000);

    // Verify balances
    // Project balance should still be 500_000 (total claimable)
    assert_eq!(client.get_balance(&project_id), 500_000);

    // Check contract's actual token balance
    // 500_000 deposited - 300_000 invested = 200_000 remaining in vault
    assert_eq!(token_client.balance(&client.address), 200_000);

    // Start milestone vote and cast winning vote so we can withdraw
    client.start_milestone_vote(&project_id, &0, &3600);
    client.vote_milestone(&user, &project_id, &0, &true);

    // Withdraw more than local balance (requires auto-divest)
    // Local is 200_000, we want 400_000. It should divest 200_000.
    client.withdraw(&project_id, &0, &400_000);

    // Verify final balances
    assert_eq!(client.get_balance(&project_id), 100_000);
    assert_eq!(token_client.balance(&owner), 400_000);

    // Vault should have 100_000 left?
    // Wait: 200_000 (local) + 200_000 (divested) - 400_000 (withdrawn) = 0 local
    // But there's still 100_000 invested.
    assert_eq!(token_client.balance(&client.address), 0);
}

#[test]
fn test_yield_refund_divests_automatically() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, owner, user, token_client, yield_id) = setup_yield_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Set yield provider
    client.set_yield_provider(&admin, &token_client.address, &yield_id);

    // Create project
    let project_id = client.create_project(
        &owner,
        &symbol_short!("YieldPrj"),
        &1_000_000,
        &token_client.address,
    );

    // Deposit funds
    client.deposit(&user, &project_id, &500_000);

    // Invest ALL funds
    client.invest_idle_funds(&owner, &project_id, &500_000);

    // Contract balance is 0
    assert_eq!(token_client.balance(&client.address), 0);

    // Cancel project
    client.cancel_project(&owner, &project_id);

    // Refund contributors (requires auto-divest)
    client.refund_contributors(&project_id, &user);

    // Verify user got their tokens back
    // User started with 10_000_000, deposited 500_000, should have 10_000_000 again.
    assert_eq!(token_client.balance(&user), 10_000_000);
}
