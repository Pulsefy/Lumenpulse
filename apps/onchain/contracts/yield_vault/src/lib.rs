#![no_std]

mod errors;
mod events;
mod storage;

use errors::YieldVaultError;
use soroban_sdk::token::TokenClient;
use soroban_sdk::{contract, contractclient, contractimpl, Address, BytesN, Env, Symbol};
use storage::{DataKey, YieldProvider};

#[contractclient(name = "YieldProviderClient")]
pub trait YieldProviderTrait {
    fn deposit(env: Env, from: Address, amount: i128) -> i128;
    fn withdraw(env: Env, to: Address, amount: i128) -> i128;
    fn balance(env: Env, address: Address) -> i128;
}

#[contract]
pub struct YieldVaultContract;

#[contractimpl]
impl YieldVaultContract {
    pub fn initialize(env: Env, admin: Address, asset: Address) -> Result<(), YieldVaultError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(YieldVaultError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Asset, &asset);
        env.storage().instance().set(&DataKey::ProviderCount, &0u32);
        env.storage().instance().extend_ttl(100, 100);

        events::VaultInitializedEvent { admin, asset }.publish(&env);

        Ok(())
    }

    pub fn register_provider(
        env: Env,
        name: Symbol,
        address: Address,
        priority: u32,
    ) -> Result<u32, YieldVaultError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(YieldVaultError::NotInitialized)?;

        admin.require_auth();

        let provider_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProviderCount)
            .unwrap_or(0);

        let provider_id = provider_count;

        let provider = YieldProvider {
            id: provider_id,
            name: name.clone(),
            address: address.clone(),
            priority,
            total_deposited: 0,
            total_withdrawn: 0,
            total_yield_earned: 0,
            is_active: true,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Provider(provider_id), &provider);

        let new_count = provider_count + 1;
        env.storage()
            .instance()
            .set(&DataKey::ProviderCount, &new_count);

        events::ProviderRegisteredEvent {
            provider_id,
            name,
            address,
            priority,
        }
        .publish(&env);

        Ok(provider_id)
    }

    pub fn deposit(
        env: Env,
        amount: i128,
        user: Address,
        request_id: BytesN<32>,
    ) -> Result<i128, YieldVaultError> {
        if idempotency_guard::claim_request(&env, &request_id).is_err() {
            return Err(YieldVaultError::AlreadyExecuted);
        }

        if amount <= 0 {
            return Err(YieldVaultError::InvalidAmount);
        }

        user.require_auth();

        let asset_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Asset)
            .ok_or(YieldVaultError::NotInitialized)?;

        let token = TokenClient::new(&env, &asset_addr);
        token.transfer(&user, env.current_contract_address(), &amount);

        let best_provider = Self::find_best_provider(&env)?;

        let provider: YieldProvider = env
            .storage()
            .persistent()
            .get(&DataKey::Provider(best_provider))
            .ok_or(YieldVaultError::ProviderNotFound)?;

        let provider_client = YieldProviderClient::new(&env, &provider.address);
        let _yield_tokens = provider_client.deposit(&env.current_contract_address(), &amount);

        let mut updated_provider = provider.clone();
        updated_provider.total_deposited += amount;
        env.storage()
            .persistent()
            .set(&DataKey::Provider(best_provider), &updated_provider);

        let user_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserBalance(user.clone()))
            .unwrap_or(0);

        env.storage().persistent().set(
            &DataKey::UserBalance(user.clone()),
            &(user_balance + amount),
        );

        let user_allocation: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserProviderAllocation(
                user.clone(),
                best_provider,
            ))
            .unwrap_or(0);

        env.storage().persistent().set(
            &DataKey::UserProviderAllocation(user.clone(), best_provider),
            &(user_allocation + amount),
        );

        let total_aum: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalAUM)
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::TotalAUM, &(total_aum + amount));

        events::DepositEvent {
            user: user.clone(),
            amount,
            provider_id: best_provider,
        }
        .publish(&env);

        Ok(amount)
    }

    pub fn withdraw(
        env: Env,
        amount: i128,
        user: Address,
        request_id: BytesN<32>,
    ) -> Result<i128, YieldVaultError> {
        if idempotency_guard::claim_request(&env, &request_id).is_err() {
            return Err(YieldVaultError::AlreadyExecuted);
        }

        if amount <= 0 {
            return Err(YieldVaultError::InvalidAmount);
        }

        user.require_auth();

        let user_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserBalance(user.clone()))
            .unwrap_or(0);

        if user_balance < amount {
            return Err(YieldVaultError::InsufficientBalance);
        }

        let provider_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProviderCount)
            .unwrap_or(0);

        let mut withdrawn = 0i128;
        let mut remaining = amount;

        for provider_id in 0..provider_count {
            if remaining == 0 {
                break;
            }

            let allocation: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::UserProviderAllocation(user.clone(), provider_id))
                .unwrap_or(0);

            if allocation > 0 {
                let to_withdraw = if remaining > allocation {
                    allocation
                } else {
                    remaining
                };

                let provider: YieldProvider = env
                    .storage()
                    .persistent()
                    .get(&DataKey::Provider(provider_id))
                    .ok_or(YieldVaultError::ProviderNotFound)?;

                let provider_client = YieldProviderClient::new(&env, &provider.address);
                let _received =
                    provider_client.withdraw(&env.current_contract_address(), &to_withdraw);

                let mut updated_provider = provider.clone();
                updated_provider.total_withdrawn += to_withdraw;
                env.storage()
                    .persistent()
                    .set(&DataKey::Provider(provider_id), &updated_provider);

                let new_allocation = allocation - to_withdraw;
                if new_allocation > 0 {
                    env.storage().persistent().set(
                        &DataKey::UserProviderAllocation(user.clone(), provider_id),
                        &new_allocation,
                    );
                } else {
                    env.storage()
                        .persistent()
                        .remove(&DataKey::UserProviderAllocation(user.clone(), provider_id));
                }

                withdrawn += to_withdraw;
                remaining -= to_withdraw;
            }
        }

        let new_balance = user_balance - withdrawn;
        if new_balance > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::UserBalance(user.clone()), &new_balance);
        } else {
            env.storage()
                .persistent()
                .remove(&DataKey::UserBalance(user.clone()));
        }

        let total_aum: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalAUM)
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::TotalAUM, &(total_aum - withdrawn));

        events::WithdrawEvent {
            user: user.clone(),
            amount: withdrawn,
        }
        .publish(&env);

        Ok(withdrawn)
    }

    pub fn harvest_yield(env: Env, provider_id: u32) -> Result<i128, YieldVaultError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(YieldVaultError::NotInitialized)?;

        admin.require_auth();

        let mut provider: YieldProvider = env
            .storage()
            .persistent()
            .get(&DataKey::Provider(provider_id))
            .ok_or(YieldVaultError::ProviderNotFound)?;

        let provider_client = YieldProviderClient::new(&env, &provider.address);
        let balance = provider_client.balance(&env.current_contract_address());

        let yield_earned = balance - provider.total_deposited + provider.total_withdrawn;

        if yield_earned > 0 {
            provider.total_yield_earned += yield_earned;
            env.storage()
                .persistent()
                .set(&DataKey::Provider(provider_id), &provider);

            let total_yield: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::TotalYieldHarvested)
                .unwrap_or(0);

            env.storage()
                .persistent()
                .set(&DataKey::TotalYieldHarvested, &(total_yield + yield_earned));
        }

        events::YieldHarvestedEvent {
            provider_id,
            yield_earned,
        }
        .publish(&env);

        Ok(yield_earned)
    }

    pub fn balance_of(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::UserBalance(user))
            .unwrap_or(0)
    }

    pub fn get_total_aum(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalAUM)
            .unwrap_or(0)
    }

    pub fn get_total_yield_harvested(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalYieldHarvested)
            .unwrap_or(0)
    }

    pub fn get_provider(env: Env, provider_id: u32) -> Result<YieldProvider, YieldVaultError> {
        env.storage()
            .persistent()
            .get(&DataKey::Provider(provider_id))
            .ok_or(YieldVaultError::ProviderNotFound)
    }

    fn find_best_provider(env: &Env) -> Result<u32, YieldVaultError> {
        let provider_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProviderCount)
            .unwrap_or(0);

        if provider_count == 0 {
            return Err(YieldVaultError::NoProvidersAvailable);
        }

        let mut best_id = 0u32;
        let mut best_priority = 0u32;

        for provider_id in 0..provider_count {
            if let Some(Some(provider)) = env
                .storage()
                .persistent()
                .get::<_, Option<YieldProvider>>(&DataKey::Provider(provider_id))
            {
                if provider.is_active && provider.priority > best_priority {
                    best_priority = provider.priority;
                    best_id = provider_id;
                }
            }
        }

        Ok(best_id)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::token::StellarAssetClient;

    #[contract]
    struct MockYieldProvider;

    #[contractimpl]
    impl MockYieldProvider {
        pub fn deposit(env: Env, from: Address, amount: i128) -> i128 {
            let current: i128 = env.storage().persistent().get(&from).unwrap_or(0);
            env.storage().persistent().set(&from, &(current + amount));
            amount
        }

        pub fn withdraw(env: Env, to: Address, amount: i128) -> i128 {
            let current: i128 = env.storage().persistent().get(&to).unwrap_or(0);
            if current < amount {
                panic!("insufficient balance in mock");
            }
            env.storage().persistent().set(&to, &(current - amount));
            amount
        }

        pub fn balance(env: Env, address: Address) -> i128 {
            env.storage().persistent().get(&address).unwrap_or(0)
        }
    }

    fn request_id(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &[0; 32])
    }

    #[test]
    fn test_deposit_idempotency() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let token_admin = Address::generate(&env);

        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let _token_client = TokenClient::new(&env, &token_id.address());
        let token_admin_client = StellarAssetClient::new(&env, &token_id.address());

        let vault_id = env.register(YieldVaultContract, ());
        let vault_client = YieldVaultContractClient::new(&env, &vault_id);

        let mock_id = env.register(MockYieldProvider, ());

        vault_client.initialize(&admin, &token_id.address());

        vault_client.register_provider(&Symbol::new(&env, "mock_provider"), &mock_id, &1);

        let deposit_amount = 1000i128;
        token_admin_client.mint(&user, &deposit_amount);

        let result = vault_client.deposit(&deposit_amount, &user, &request_id(&env));
        assert_eq!(result, deposit_amount);

        let result = vault_client.try_deposit(&deposit_amount, &user, &request_id(&env));
        assert_eq!(result, Err(Ok(YieldVaultError::AlreadyExecuted)));
    }

    #[test]
    fn test_withdraw_idempotency() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let token_admin = Address::generate(&env);

        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let _token_client = TokenClient::new(&env, &token_id.address());
        let token_admin_client = StellarAssetClient::new(&env, &token_id.address());

        let vault_id = env.register(YieldVaultContract, ());
        let vault_client = YieldVaultContractClient::new(&env, &vault_id);

        let mock_id = env.register(MockYieldProvider, ());

        vault_client.initialize(&admin, &token_id.address());
        vault_client.register_provider(&Symbol::new(&env, "mock_provider"), &mock_id, &1);

        let deposit_amount = 1000i128;
        token_admin_client.mint(&user, &deposit_amount);
        vault_client.deposit(&deposit_amount, &user, &BytesN::from_array(&env, &[1; 32]));

        let withdraw_amount = 500i128;
        let result = vault_client.withdraw(&withdraw_amount, &user, &request_id(&env));
        assert_eq!(result, withdraw_amount);

        let result = vault_client.try_withdraw(&withdraw_amount, &user, &request_id(&env));
        assert_eq!(result, Err(Ok(YieldVaultError::AlreadyExecuted)));
    }
}
