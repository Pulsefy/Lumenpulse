#![no_std]

mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, contractclient, Address, Env, Symbol, Vec, vec, U32};
use soroban_sdk::token::TokenClient;
use storage::{DataKey, YieldProvider, ProviderMetrics};

#[contractclient(name = "YieldProviderClient")]
pub trait YieldProviderTrait {
    fn deposit(env: Env, from: Address, amount: i128) -> i128;
    fn withdraw(env: Env, to: Address, amount: i128) -> i128;
    fn balance(env: Env, address: Address) -> i128;
}

#[contract]
pub struct YieldVaultContract;

/// YieldVault - Multi-provider yield optimization
///
/// This contract wraps multiple yield providers and:
/// - Manages allocation across providers
/// - Tracks yields earned per provider
/// - Allows yield harvesting
/// - Routes deposits to highest-yield providers
/// - Maintains user balances and claims
#[contractimpl]
impl YieldVaultContract {
    /// Initialize the vault
    pub fn initialize(
        env: Env,
        admin: Address,
        asset: Address,
    ) -> Result<(), Symbol> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Symbol::new(&env, "already_initialized"));
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Asset, &asset);
        env.storage().instance().set(&DataKey::ProviderCount, &0u32);
        env.storage().instance().bump(100, 100);

        events::VaultInitializedEvent { admin, asset }
            .publish(&env);

        Ok(())
    }

    /// Register a new yield provider
    pub fn register_provider(
        env: Env,
        name: Symbol,
        address: Address,
        priority: u32, // Higher = preferred for deposits
    ) -> Result<u32, Symbol> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or_else(|| Symbol::new(&env, "not_initialized"))?;

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

    /// Deposit tokens into the vault
    /// Automatically allocates to highest-yield provider
    pub fn deposit(
        env: Env,
        amount: i128,
        user: Address,
    ) -> Result<i128, Symbol> {
        if amount <= 0 {
            return Err(Symbol::new(&env, "invalid_amount"));
        }

        let asset_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Asset)
            .ok_or_else(|| Symbol::new(&env, "not_initialized"))?;

        // Transfer tokens from caller
        let token = TokenClient::new(&env, &asset_addr);
        token.transfer(&env.invoker(), &env.current_contract_address(), &amount);

        // Find best provider (highest priority, is_active)
        let best_provider = Self::find_best_provider(&env)?;

        // Deposit to provider
        let provider: YieldProvider = env
            .storage()
            .persistent()
            .get(&DataKey::Provider(best_provider))
            .ok_or_else(|| Symbol::new(&env, "provider_not_found"))?;

        let provider_client = YieldProviderClient::new(&env, &provider.address);
        let _yield_tokens = provider_client.deposit(&env.current_contract_address(), &amount);

        // Update vault state
        let mut updated_provider = provider.clone();
        updated_provider.total_deposited += amount;
        env.storage()
            .persistent()
            .set(&DataKey::Provider(best_provider), &updated_provider);

        // Track user deposit
        let user_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserBalance(user.clone()))
            .unwrap_or(0);

        env.storage().persistent().set(
            &DataKey::UserBalance(user.clone()),
            &(user_balance + amount),
        );

        // Track allocation per user-provider
        let user_allocation: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserProviderAllocation(user.clone(), best_provider))
            .unwrap_or(0);

        env.storage().persistent().set(
            &DataKey::UserProviderAllocation(user.clone(), best_provider),
            &(user_allocation + amount),
        );

        // Update total vault AUM
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

    /// Withdraw tokens from the vault
    /// Attempts to withdraw from provider with user's allocation
    pub fn withdraw(
        env: Env,
        amount: i128,
        user: Address,
    ) -> Result<i128, Symbol> {
        if amount <= 0 {
            return Err(Symbol::new(&env, "invalid_amount"));
        }

        let user_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserBalance(user.clone()))
            .unwrap_or(0);

        if user_balance < amount {
            return Err(Symbol::new(&env, "insufficient_balance"));
        }

        // Find provider with user's allocation (FIFO: use first provider with balance)
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
                let to_withdraw = if remaining > allocation { allocation } else { remaining };

                let provider: YieldProvider = env
                    .storage()
                    .persistent()
                    .get(&DataKey::Provider(provider_id))
                    .ok_or_else(|| Symbol::new(&env, "provider_not_found"))?;

                let provider_client = YieldProviderClient::new(&env, &provider.address);
                let _received = provider_client.withdraw(&env.invoker(), &to_withdraw);

                // Update tracking
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
                    env.storage().persistent().remove(&DataKey::UserProviderAllocation(
                        user.clone(),
                        provider_id,
                    ));
                }

                withdrawn += to_withdraw;
                remaining -= to_withdraw;
            }
        }

        // Update user balance
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

        // Update total vault AUM
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

    /// Harvest yield earned by a specific provider
    /// Routes yield to a reward pool or redistributes to LPs
    pub fn harvest_yield(
        env: Env,
        provider_id: u32,
    ) -> Result<i128, Symbol> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or_else(|| Symbol::new(&env, "not_initialized"))?;

        admin.require_auth();

        let mut provider: YieldProvider = env
            .storage()
            .persistent()
            .get(&DataKey::Provider(provider_id))
            .ok_or_else(|| Symbol::new(&env, "provider_not_found"))?;

        let provider_client = YieldProviderClient::new(&env, &provider.address);
        let balance = provider_client.balance(&env.current_contract_address());

        // Estimate yield = (balance - deposited + withdrawn)
        let yield_earned = balance - provider.total_deposited + provider.total_withdrawn;

        if yield_earned > 0 {
            provider.total_yield_earned += yield_earned;
            env.storage()
                .persistent()
                .set(&DataKey::Provider(provider_id), &provider);

            // Track total yield for later distribution
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

    /// Get user's balance
    pub fn balance_of(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::UserBalance(user))
            .unwrap_or(0)
    }

    /// Get total vault AUM
    pub fn get_total_aum(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalAUM)
            .unwrap_or(0)
    }

    /// Get total harvested yield
    pub fn get_total_yield_harvested(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalYieldHarvested)
            .unwrap_or(0)
    }

    /// Get provider info
    pub fn get_provider(env: Env, provider_id: u32) -> Result<YieldProvider, Symbol> {
        env.storage()
            .persistent()
            .get(&DataKey::Provider(provider_id))
            .ok_or_else(|| Symbol::new(&env, "provider_not_found"))
    }

    /// Find best active provider by priority
    fn find_best_provider(env: &Env) -> Result<u32, Symbol> {
        let provider_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProviderCount)
            .unwrap_or(0);

        if provider_count == 0 {
            return Err(Symbol::new(env, "no_providers_available"));
        }

        let mut best_id = 0u32;
        let mut best_priority = 0u32;

        for provider_id in 0..provider_count {
            if let Ok(Some(provider)) = env
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
