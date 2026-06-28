#![no_std]

mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec, vec, Map};
use soroban_sdk::token::TokenClient;
use storage::DataKey;

const STABLE_RATE: u32 = 500; // 5% annual in basis points
const VARIABLE_RATE: u32 = 300; // 3% annual

#[contract]
pub struct AaveLendingPoolContract;

/// Mock Aave Lending Pool
/// - Simulates interest accrual on deposits
/// - Multiple reserve tokens
/// - Tracks user deposits and earned interest
/// - Calculates APY based on utilization
#[contractimpl]
impl AaveLendingPoolContract {
    /// Initialize the pool
    pub fn initialize(env: Env, admin: Address) -> Result<(), Symbol> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Symbol::new(&env, "already_initialized"));
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().bump(100, 100);

        events::PoolInitializedEvent { admin }
            .publish(&env);

        Ok(())
    }

    /// Deposit tokens into the pool
    /// Returns the amount of aTokens (interest-bearing tokens) minted
    pub fn deposit(env: Env, asset: Address, amount: i128, on_behalf_of: Address) -> Result<i128, Symbol> {
        if amount <= 0 {
            return Err(Symbol::new(&env, "invalid_amount"));
        }

        let admin = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Admin)
            .ok_or_else(|| Symbol::new(&env, "not_initialized"))?;

        // Transfer tokens from caller to pool
        let token = TokenClient::new(&env, &asset);
        token.transfer(&env.invoker(), &env.current_contract_address(), &amount);

        // Calculate aToken amount (initially 1:1, but changes with accrual)
        let reserve: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve(asset.clone()))
            .unwrap_or(0);

        let a_token_supply: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::ATokenSupply(asset.clone()))
            .unwrap_or(0);

        let a_tokens = if a_token_supply == 0 {
            amount // First deposit is 1:1
        } else {
            // Scale based on current reserve and aToken supply
            (amount * a_token_supply) / (reserve + 1)
        };

        // Update reserve
        let new_reserve = reserve + amount;
        env.storage()
            .persistent()
            .set(&DataKey::Reserve(asset.clone()), &new_reserve);

        // Update aToken supply
        let new_a_token_supply = a_token_supply + a_tokens;
        env.storage()
            .persistent()
            .set(&DataKey::ATokenSupply(asset.clone()), &new_a_token_supply);

        // Track user deposit
        let user_a_tokens: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserATokenBalance(on_behalf_of.clone(), asset.clone()))
            .unwrap_or(0);

        env.storage().persistent().set(
            &DataKey::UserATokenBalance(on_behalf_of.clone(), asset.clone()),
            &(user_a_tokens + a_tokens),
        );

        // Track deposit timestamp for interest calculation
        env.storage().persistent().set(
            &DataKey::UserDepositTimestamp(on_behalf_of.clone(), asset.clone()),
            &env.ledger().timestamp(),
        );

        events::DepositEvent {
            user: on_behalf_of,
            asset,
            amount,
            a_tokens,
        }
        .publish(&env);

        Ok(a_tokens)
    }

    /// Withdraw tokens from the pool
    /// Burns aTokens and returns underlying tokens plus accrued interest
    pub fn withdraw(env: Env, asset: Address, amount: i128, to: Address) -> Result<i128, Symbol> {
        if amount <= 0 {
            return Err(Symbol::new(&env, "invalid_amount"));
        }

        let user = env.invoker();

        // Get user's aToken balance
        let user_a_tokens: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserATokenBalance(user.clone(), asset.clone()))
            .unwrap_or(0);

        if user_a_tokens < amount {
            return Err(Symbol::new(&env, "insufficient_balance"));
        }

        // Calculate underlying tokens (with interest)
        let a_token_supply: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::ATokenSupply(asset.clone()))
            .unwrap_or(0);

        let reserve: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve(asset.clone()))
            .unwrap_or(0);

        let underlying = if a_token_supply == 0 {
            amount
        } else {
            (amount * reserve) / a_token_supply
        };

        // Update reserve
        let new_reserve = reserve - underlying;
        env.storage()
            .persistent()
            .set(&DataKey::Reserve(asset.clone()), &new_reserve);

        // Update aToken supply
        let new_a_token_supply = a_token_supply - amount;
        env.storage()
            .persistent()
            .set(&DataKey::ATokenSupply(asset.clone()), &new_a_token_supply);

        // Update user balance
        let new_user_a_tokens = user_a_tokens - amount;
        env.storage().persistent().set(
            &DataKey::UserATokenBalance(user.clone(), asset.clone()),
            &new_user_a_tokens,
        );

        // Transfer tokens to recipient
        let token = TokenClient::new(&env, &asset);
        token.transfer(&env.current_contract_address(), &to, &underlying);

        events::WithdrawEvent {
            user,
            asset,
            amount,
            underlying,
        }
        .publish(&env);

        Ok(underlying)
    }

    /// Get user's aToken balance
    pub fn balance_of(env: Env, user: Address, asset: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::UserATokenBalance(user, asset))
            .unwrap_or(0)
    }

    /// Get current reserve (total deposited tokens)
    pub fn get_reserve(env: Env, asset: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Reserve(asset))
            .unwrap_or(0)
    }

    /// Calculate current APY based on utilization
    /// Returns basis points (e.g., 500 = 5%)
    pub fn get_variable_rate(env: Env, asset: Address) -> u32 {
        let reserve: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve(asset.clone()))
            .unwrap_or(0);

        let total_debt: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalDebt(asset))
            .unwrap_or(0);

        if reserve == 0 {
            return VARIABLE_RATE;
        }

        // Utilization = debt / (debt + reserve)
        let utilization = (total_debt * 100) / (total_debt + reserve);

        // APY increases with utilization: 3% + (utilization * 2%)
        VARIABLE_RATE + ((utilization as u32) * 20)
    }

    /// Simulate interest accrual (called periodically)
    pub fn accrue_interest(env: Env, asset: Address) -> Result<i128, Symbol> {
        let reserve: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve(asset.clone()))
            .unwrap_or(0);

        let last_accrual: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::LastAccrualTime(asset.clone()))
            .unwrap_or(env.ledger().timestamp());

        let current_time = env.ledger().timestamp();
        let elapsed = current_time - last_accrual;

        if elapsed == 0 {
            return Ok(0);
        }

        // Simple interest: reserve * rate * time / (365 * 24 * 3600) / 10000
        let rate = Self::get_variable_rate(&env, asset.clone());
        let seconds_per_year = 365 * 24 * 3600;
        let interest = (reserve * (rate as i128) * (elapsed as i128)) / ((seconds_per_year as i128) * 10000);

        // Update reserve with accrued interest
        let new_reserve = reserve + interest;
        env.storage()
            .persistent()
            .set(&DataKey::Reserve(asset.clone()), &new_reserve);

        // Update accrual timestamp
        env.storage()
            .persistent()
            .set(&DataKey::LastAccrualTime(asset), &current_time);

        events::InterestAccruedEvent {
            reserve: new_reserve,
            interest,
            elapsed,
        }
        .publish(&env);

        Ok(interest)
    }
}
