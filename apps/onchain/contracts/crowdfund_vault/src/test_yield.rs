use crate::yield_provider::YieldProviderTrait;
use crate::{CrowdfundVaultContract, CrowdfundVaultContractClient};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Ledger},
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

    fn withdraw(env: Env, to: Address, amount: i128) -> i128 {
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
        amount
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

    // Approve milestone so we can withdraw
    client.approve_milestone(&admin, &project_id, &0);

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

// Mock Lending Protocol - simulates lending tokens and earning interest
#[contract]
pub struct MockLendingProtocol;

#[contractimpl]
impl MockLendingProtocol {
    pub fn initialize(env: Env, token: Address, interest_rate: u32) {
        // interest_rate in basis points (e.g., 500 = 5%)
        env.storage()
            .instance()
            .set(&symbol_short!("token"), &token);
        env.storage()
            .instance()
            .set(&symbol_short!("rate"), &interest_rate);
    }
}

#[contractimpl]
impl YieldProviderTrait for MockLendingProtocol {
    fn deposit(env: Env, from: Address, amount: i128) {
        let _token_addr: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("token"))
            .unwrap();

        // Tokens are transferred to this provider contract by the vault before calling deposit.
        let current_principal: i128 = env.storage().persistent().get(&from).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&from, &(current_principal + amount));
    }

    fn withdraw(env: Env, to: Address, amount: i128) -> i128 {
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("token"))
            .unwrap();
        let token = TokenClient::new(&env, &token_addr);

        let current_principal: i128 = env.storage().persistent().get(&to).unwrap_or(0);
        if current_principal < amount {
            panic!("insufficient principal balance");
        }

        // Calculate interest earned (simplified: 5% APY for simplicity)
        let interest_rate: u32 = env
            .storage()
            .instance()
            .get(&symbol_short!("rate"))
            .unwrap();
        let interest = (amount * interest_rate as i128) / 10000; // basis points

        let total_withdrawal = amount + interest;

        // Transfer tokens back (assuming contract has enough tokens)
        token.transfer(&env.current_contract_address(), &to, &total_withdrawal);

        env.storage()
            .persistent()
            .set(&to, &(current_principal - amount));
        total_withdrawal
    }

    fn balance(env: Env, address: Address) -> i128 {
        env.storage().persistent().get(&address).unwrap_or(0)
    }
}

// Mock Staking Protocol - simulates staking tokens for rewards
#[contract]
pub struct MockStakingProtocol;

#[contractimpl]
impl MockStakingProtocol {
    pub fn initialize(env: Env, token: Address, reward_rate: u32) {
        // reward_rate in basis points
        env.storage()
            .instance()
            .set(&symbol_short!("token"), &token);
        env.storage()
            .instance()
            .set(&symbol_short!("rewards"), &reward_rate);
    }
}

#[contractimpl]
impl YieldProviderTrait for MockStakingProtocol {
    fn deposit(env: Env, from: Address, amount: i128) {
        let _token_addr: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("token"))
            .unwrap();

        // Tokens are transferred to this provider contract by the vault before calling deposit.
        let current_staked: i128 = env.storage().persistent().get(&from).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&from, &(current_staked + amount));

        // Track stake timestamp for reward calculation
        let timestamp_key = symbol_short!("staketime");
        env.storage()
            .persistent()
            .set(&(timestamp_key, from.clone()), &env.ledger().timestamp());
    }

    fn withdraw(env: Env, to: Address, amount: i128) -> i128 {
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("token"))
            .unwrap();
        let token = TokenClient::new(&env, &token_addr);

        let current_staked: i128 = env.storage().persistent().get(&to).unwrap_or(0);
        if current_staked < amount {
            panic!("insufficient staked balance");
        }

        // Calculate staking rewards based on time
        let reward_rate: u32 = env
            .storage()
            .instance()
            .get(&symbol_short!("rewards"))
            .unwrap();
        let timestamp_key = symbol_short!("staketime");
        let stake_time: u64 = env
            .storage()
            .persistent()
            .get(&(timestamp_key, to.clone()))
            .unwrap();
        let time_elapsed = env.ledger().timestamp() - stake_time;

        // Simplified reward calculation: reward_rate basis points per day
        let days_elapsed = time_elapsed / (24 * 60 * 60);
        let rewards = (amount * reward_rate as i128 * days_elapsed as i128) / 10000;

        let total_withdrawal = amount + rewards;

        // Transfer tokens back
        token.transfer(&env.current_contract_address(), &to, &total_withdrawal);

        env.storage()
            .persistent()
            .set(&to, &(current_staked - amount));
        total_withdrawal
    }

    fn balance(env: Env, address: Address) -> i128 {
        env.storage().persistent().get(&address).unwrap_or(0)
    }
}

// Mock AMM Protocol - simulates providing liquidity to an AMM pool
#[contract]
pub struct MockAMMProtocol;

#[contractimpl]
impl MockAMMProtocol {
    pub fn initialize(env: Env, token: Address, pair_token: Address, fee_rate: u32) {
        // fee_rate in basis points
        env.storage()
            .instance()
            .set(&symbol_short!("token"), &token);
        env.storage()
            .instance()
            .set(&symbol_short!("pairtok"), &pair_token);
        env.storage()
            .instance()
            .set(&symbol_short!("fee_rate"), &fee_rate);
    }
}

#[contractimpl]
impl YieldProviderTrait for MockAMMProtocol {
    fn deposit(env: Env, from: Address, amount: i128) {
        let _token_addr: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("token"))
            .unwrap();

        // Tokens are transferred to this provider contract by the vault before calling deposit.
        let current_liquidity: i128 = env.storage().persistent().get(&from).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&from, &(current_liquidity + amount));
    }

    fn withdraw(env: Env, to: Address, amount: i128) -> i128 {
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("token"))
            .unwrap();
        let token = TokenClient::new(&env, &token_addr);

        let current_liquidity: i128 = env.storage().persistent().get(&to).unwrap_or(0);
        if current_liquidity < amount {
            panic!("insufficient liquidity position");
        }

        // Calculate trading fees earned (simplified)
        let fee_rate: u32 = env
            .storage()
            .instance()
            .get(&symbol_short!("fee_rate"))
            .unwrap();
        let fees_earned = (amount * fee_rate as i128) / 10000;

        let total_withdrawal = amount + fees_earned;

        // Transfer tokens back
        token.transfer(&env.current_contract_address(), &to, &total_withdrawal);

        env.storage()
            .persistent()
            .set(&to, &(current_liquidity - amount));
        total_withdrawal
    }

    fn balance(env: Env, address: Address) -> i128 {
        env.storage().persistent().get(&address).unwrap_or(0)
    }
}

#[test]
fn test_staking_protocol_yield() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault_client, admin, owner, user, token_client, _) = setup_yield_test(&env);

    // Register staking protocol
    let staking_id = env.register(MockStakingProtocol, ());
    let staking_client = MockStakingProtocolClient::new(&env, &staking_id);
    staking_client.initialize(&token_client.address, &300); // 3% daily reward rate

    // Give tokens to staking protocol
    let token_admin_client = StellarAssetClient::new(&env, &token_client.address);
    token_admin_client.mint(&staking_id, &1_000_000);

    // Initialize and set yield provider
    vault_client.initialize(&admin);
    vault_client.set_yield_provider(&admin, &token_client.address, &staking_id);

    // Create project and deposit
    let project_id = vault_client.create_project(
        &owner,
        &symbol_short!("StakePrj"),
        &1_000_000,
        &token_client.address,
    );
    vault_client.deposit(&user, &project_id, &500_000);

    // Invest in staking protocol
    vault_client.invest_idle_funds(&owner, &project_id, &300_000);

    // Simulate time passing for reward accrual
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + 10 * 24 * 60 * 60); // 10 days

    // Approve milestone and withdraw enough to trigger a divest and earn yield
    vault_client.approve_milestone(&admin, &project_id, &0);
    vault_client.withdraw(&project_id, &0, &400_000);

    assert_eq!(token_client.balance(&owner), 400_000);
    assert_eq!(vault_client.get_balance(&project_id), 160_000);
}

#[test]
fn test_amm_protocol_yield() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault_client, admin, owner, user, token_client, _) = setup_yield_test(&env);

    // Create a pair token for AMM
    let pair_token_admin = Address::generate(&env);
    let pair_token_addr = env.register_stellar_asset_contract_v2(pair_token_admin.clone());
    let pair_token_client = TokenClient::new(&env, &pair_token_addr.address());
    let pair_token_admin_client = StellarAssetClient::new(&env, &pair_token_addr.address());

    // Register AMM protocol
    let amm_id = env.register(MockAMMProtocol, ());
    let amm_client = MockAMMProtocolClient::new(&env, &amm_id);
    amm_client.initialize(&token_client.address, &pair_token_addr.address(), &30); // 0.3% fee

    // Give tokens to AMM protocol
    let token_admin_client = StellarAssetClient::new(&env, &token_client.address);
    token_admin_client.mint(&amm_id, &1_000_000);

    // Initialize and set yield provider
    vault_client.initialize(&admin);
    vault_client.set_yield_provider(&admin, &token_client.address, &amm_id);

    // Create project and deposit
    let project_id = vault_client.create_project(
        &owner,
        &symbol_short!("AMMPrj"),
        &1_000_000,
        &token_client.address,
    );
    vault_client.deposit(&user, &project_id, &500_000);

    // Invest in AMM protocol
    vault_client.invest_idle_funds(&owner, &project_id, &300_000);

    // Approve milestone and withdraw enough to trigger a divest and earn fees
    vault_client.approve_milestone(&admin, &project_id, &0);
    vault_client.withdraw(&project_id, &0, &400_000);

    assert_eq!(token_client.balance(&owner), 400_000);
    assert_eq!(vault_client.get_balance(&project_id), 100_600);
}
