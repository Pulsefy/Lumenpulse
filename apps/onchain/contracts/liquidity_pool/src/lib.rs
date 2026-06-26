#![no_std]

mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};
use soroban_sdk::token::TokenClient;
use storage::DataKey;

const SWAP_FEE_BP: u32 = 30; // 0.3% swap fee in basis points (Uniswap v2 standard)

#[contract]
pub struct LiquidityPoolContract;

/// Mock Uniswap-like Liquidity Pool
/// - Constant product AMM (x * y = k)
/// - Yield from trading fees distributed to LPs
/// - Standard LP token mechanics
#[contractimpl]
impl LiquidityPoolContract {
    /// Initialize pool with two tokens
    pub fn initialize(env: Env, admin: Address, token_0: Address, token_1: Address) -> Result<(), Symbol> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Symbol::new(&env, "already_initialized"));
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Token0, &token_0);
        env.storage()
            .instance()
            .set(&DataKey::Token1, &token_1);
        env.storage().instance().bump(100, 100);

        events::PoolInitializedEvent {
            admin,
            token_0,
            token_1,
        }
        .publish(&env);

        Ok(())
    }

    /// Add liquidity and receive LP tokens
    pub fn add_liquidity(
        env: Env,
        amount_0: i128,
        amount_1: i128,
        min_lp: i128,
    ) -> Result<i128, Symbol> {
        if amount_0 <= 0 || amount_1 <= 0 {
            return Err(Symbol::new(&env, "invalid_amount"));
        }

        let token_0_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token0)
            .ok_or_else(|| Symbol::new(&env, "not_initialized"))?;

        let token_1_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token1)
            .ok_or_else(|| Symbol::new(&env, "not_initialized"))?;

        // Transfer tokens
        let token_0 = TokenClient::new(&env, &token_0_addr);
        let token_1 = TokenClient::new(&env, &token_1_addr);

        token_0.transfer(&env.invoker(), &env.current_contract_address(), &amount_0);
        token_1.transfer(&env.invoker(), &env.current_contract_address(), &amount_1);

        // Calculate LP tokens
        let reserve_0: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve0)
            .unwrap_or(0);

        let reserve_1: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve1)
            .unwrap_or(0);

        let lp_supply: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::LPSupply)
            .unwrap_or(0);

        let lp_tokens = if lp_supply == 0 {
            // First liquidity: geometric mean
            Self::isqrt((amount_0 as u128) * (amount_1 as u128)) as i128
        } else {
            // New LP = min(amount_0 * lp_supply / reserve_0, amount_1 * lp_supply / reserve_1)
            let lp_0 = (amount_0 * lp_supply) / (reserve_0 + 1);
            let lp_1 = (amount_1 * lp_supply) / (reserve_1 + 1);
            if lp_0 < lp_1 {
                lp_0
            } else {
                lp_1
            }
        };

        if lp_tokens < min_lp {
            return Err(Symbol::new(&env, "slippage_exceeded"));
        }

        // Update state
        env.storage()
            .persistent()
            .set(&DataKey::Reserve0, &(reserve_0 + amount_0));
        env.storage()
            .persistent()
            .set(&DataKey::Reserve1, &(reserve_1 + amount_1));
        env.storage()
            .persistent()
            .set(&DataKey::LPSupply, &(lp_supply + lp_tokens));

        let user_lp: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserLPBalance(env.invoker()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::UserLPBalance(env.invoker()),
            &(user_lp + lp_tokens),
        );

        // Accrue fees to reserves (simulating LP fee sharing)
        Self::accrue_protocol_fees(&env);

        events::LiquidityAddedEvent {
            user: env.invoker(),
            amount_0,
            amount_1,
            lp_tokens,
        }
        .publish(&env);

        Ok(lp_tokens)
    }

    /// Remove liquidity and burn LP tokens
    pub fn remove_liquidity(env: Env, lp_amount: i128, min_0: i128, min_1: i128) -> Result<(i128, i128), Symbol> {
        if lp_amount <= 0 {
            return Err(Symbol::new(&env, "invalid_amount"));
        }

        let user = env.invoker();
        let user_lp: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserLPBalance(user.clone()))
            .unwrap_or(0);

        if user_lp < lp_amount {
            return Err(Symbol::new(&env, "insufficient_balance"));
        }

        let reserve_0: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve0)
            .unwrap_or(0);

        let reserve_1: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve1)
            .unwrap_or(0);

        let lp_supply: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::LPSupply)
            .unwrap_or(0);

        // Calculate output amounts
        let out_0 = (lp_amount * reserve_0) / lp_supply;
        let out_1 = (lp_amount * reserve_1) / lp_supply;

        if out_0 < min_0 || out_1 < min_1 {
            return Err(Symbol::new(&env, "slippage_exceeded"));
        }

        // Update state
        env.storage()
            .persistent()
            .set(&DataKey::Reserve0, &(reserve_0 - out_0));
        env.storage()
            .persistent()
            .set(&DataKey::Reserve1, &(reserve_1 - out_1));
        env.storage()
            .persistent()
            .set(&DataKey::LPSupply, &(lp_supply - lp_amount));
        env.storage().persistent().set(
            &DataKey::UserLPBalance(user.clone()),
            &(user_lp - lp_amount),
        );

        // Transfer tokens
        let token_0_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token0)
            .ok_or_else(|| Symbol::new(&env, "not_initialized"))?;
        let token_1_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token1)
            .ok_or_else(|| Symbol::new(&env, "not_initialized"))?;

        let token_0 = TokenClient::new(&env, &token_0_addr);
        let token_1 = TokenClient::new(&env, &token_1_addr);

        token_0.transfer(&env.current_contract_address(), &user, &out_0);
        token_1.transfer(&env.current_contract_address(), &user, &out_1);

        events::LiquidityRemovedEvent {
            user,
            lp_tokens: lp_amount,
            amount_0: out_0,
            amount_1: out_1,
        }
        .publish(&env);

        Ok((out_0, out_1))
    }

    /// Swap token_0 for token_1
    pub fn swap_exact_in(env: Env, amount_in: i128, min_out: i128) -> Result<i128, Symbol> {
        if amount_in <= 0 {
            return Err(Symbol::new(&env, "invalid_amount"));
        }

        let token_0_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token0)
            .ok_or_else(|| Symbol::new(&env, "not_initialized"))?;

        let token_1_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token1)
            .ok_or_else(|| Symbol::new(&env, "not_initialized"))?;

        let reserve_0: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve0)
            .unwrap_or(0);

        let reserve_1: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve1)
            .unwrap_or(0);

        // Deduct fee: amount_in * (10000 - fee) / 10000
        let amount_in_after_fee = (amount_in * (10000 - SWAP_FEE_BP as i128)) / 10000;

        // Constant product formula: (x + dx) * (y - dy) = x * y
        // dy = y * dx / (x + dx)
        let amount_out = (reserve_1 * amount_in_after_fee) / (reserve_0 + amount_in_after_fee);

        if amount_out < min_out {
            return Err(Symbol::new(&env, "slippage_exceeded"));
        }

        // Transfer tokens
        let token_0 = TokenClient::new(&env, &token_0_addr);
        let token_1 = TokenClient::new(&env, &token_1_addr);

        token_0.transfer(&env.invoker(), &env.current_contract_address(), &amount_in);
        token_1.transfer(&env.current_contract_address(), &env.invoker(), &amount_out);

        // Update reserves (fee stays in pool as yield to LPs)
        env.storage()
            .persistent()
            .set(&DataKey::Reserve0, &(reserve_0 + amount_in));
        env.storage()
            .persistent()
            .set(&DataKey::Reserve1, &(reserve_1 - amount_out));

        events::SwapEvent {
            user: env.invoker(),
            amount_in,
            amount_out,
        }
        .publish(&env);

        Ok(amount_out)
    }

    /// Integer square root
    fn isqrt(n: u128) -> u128 {
        if n == 0 {
            return 0;
        }
        let mut x = n;
        let mut y = (x + 1) / 2;
        while y < x {
            x = y;
            y = (x + n / x) / 2;
        }
        x
    }

    /// Accrue protocol fees (simulated: record that fees are earned)
    fn accrue_protocol_fees(env: &Env) {
        let last_accrual: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::LastFeeAccrual)
            .unwrap_or(env.ledger().timestamp());

        let reserve_0: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve0)
            .unwrap_or(0);

        let reserve_1: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve1)
            .unwrap_or(0);

        let current_time = env.ledger().timestamp();
        let elapsed = current_time - last_accrual;

        // Simulate 0.05% annual fee accrual on reserves
        let fee_accrual_bp = 5; // 0.05%
        let accrued_0 = (reserve_0 * (fee_accrual_bp as i128) * (elapsed as i128)) / ((365 * 24 * 3600 as i128) * 10000);
        let accrued_1 = (reserve_1 * (fee_accrual_bp as i128) * (elapsed as i128)) / ((365 * 24 * 3600 as i128) * 10000);

        // Track accrued fees
        let total_accrued_0: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::AccruedFees0)
            .unwrap_or(0);

        let total_accrued_1: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::AccruedFees1)
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::AccruedFees0, &(total_accrued_0 + accrued_0));
        env.storage()
            .persistent()
            .set(&DataKey::AccruedFees1, &(total_accrued_1 + accrued_1));
        env.storage()
            .persistent()
            .set(&DataKey::LastFeeAccrual, &current_time);
    }

    /// Get LP token balance
    pub fn lp_balance(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::UserLPBalance(user))
            .unwrap_or(0)
    }

    /// Get current reserves
    pub fn get_reserves(env: Env) -> (i128, i128) {
        let r0: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve0)
            .unwrap_or(0);
        let r1: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve1)
            .unwrap_or(0);
        (r0, r1)
    }

    /// Get accrued fees
    pub fn get_accrued_fees(env: Env) -> (i128, i128) {
        let f0: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::AccruedFees0)
            .unwrap_or(0);
        let f1: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::AccruedFees1)
            .unwrap_or(0);
        (f0, f1)
    }
}
