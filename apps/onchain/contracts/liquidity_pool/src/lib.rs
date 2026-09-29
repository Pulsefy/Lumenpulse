#![no_std]

mod events;
mod storage;

#[cfg(test)]
mod test;

use reentrancy_guard::{acquire as acquire_reentrancy, release as release_reentrancy};
use soroban_sdk::token::TokenClient;
use soroban_sdk::{contract, contracterror, contractimpl, Address, Env};
use storage::{DataKey, LEDGER_BUMP, LEDGER_THRESHOLD};

const SWAP_FEE_BP: u32 = 30; // 0.3% swap fee in basis points (Uniswap v2 standard)

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum LiquidityPoolError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    SlippageExceeded = 4,
    InsufficientBalance = 5,
    Reentrancy = 6,
}

#[contract]
pub struct LiquidityPoolContract;

/// Mock Uniswap-like Liquidity Pool
/// - Constant product AMM (x * y = k)
/// - Yield from trading fees distributed to LPs
/// - Standard LP token mechanics
#[contractimpl]
impl LiquidityPoolContract {
    fn with_reentrancy_guard<T, F>(env: &Env, f: F) -> Result<T, LiquidityPoolError>
    where
        F: FnOnce() -> Result<T, LiquidityPoolError>,
    {
        acquire_reentrancy(env).map_err(|_| LiquidityPoolError::Reentrancy)?;
        let result = f();
        release_reentrancy(env);
        result
    }

    /// Extends the shared instance-storage TTL (covers `Admin`, `Token0`,
    /// `Token1` together, since instance TTL is one bucket per contract).
    fn touch_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Extends `key`'s persistent-storage TTL if it exists. Safe to call
    /// unconditionally after a read or write — a `.set()` guarantees the key
    /// exists, and reads that default via `unwrap_or` may target a key that
    /// was never written yet, which `extend_ttl` would otherwise panic on.
    fn touch_persistent(env: &Env, key: &DataKey) {
        if env.storage().persistent().has(key) {
            env.storage()
                .persistent()
                .extend_ttl(key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
    }

    /// Initialize pool with two tokens
    pub fn initialize(
        env: Env,
        admin: Address,
        token_0: Address,
        token_1: Address,
    ) -> Result<(), LiquidityPoolError> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(LiquidityPoolError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token0, &token_0);
        env.storage().instance().set(&DataKey::Token1, &token_1);
        Self::touch_instance(&env);

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
        from: Address,
        amount_0: i128,
        amount_1: i128,
        min_lp: i128,
    ) -> Result<i128, LiquidityPoolError> {
        from.require_auth();
        Self::with_reentrancy_guard(&env, || {
            if amount_0 <= 0 || amount_1 <= 0 {
                return Err(LiquidityPoolError::InvalidAmount);
            }

            let token_0_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token0)
                .ok_or(LiquidityPoolError::NotInitialized)?;

            let token_1_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token1)
                .ok_or(LiquidityPoolError::NotInitialized)?;
            Self::touch_instance(&env);

            // Transfer tokens
            let token_0 = TokenClient::new(&env, &token_0_addr);
            let token_1 = TokenClient::new(&env, &token_1_addr);

            token_0.transfer(&from, env.current_contract_address(), &amount_0);
            token_1.transfer(&from, env.current_contract_address(), &amount_1);

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
                return Err(LiquidityPoolError::SlippageExceeded);
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
            Self::touch_persistent(&env, &DataKey::Reserve0);
            Self::touch_persistent(&env, &DataKey::Reserve1);
            Self::touch_persistent(&env, &DataKey::LPSupply);

            let user_lp: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::UserLPBalance(from.clone()))
                .unwrap_or(0);
            env.storage().persistent().set(
                &DataKey::UserLPBalance(from.clone()),
                &(user_lp + lp_tokens),
            );
            Self::touch_persistent(&env, &DataKey::UserLPBalance(from.clone()));

            // Accrue fees to reserves (simulating LP fee sharing)
            Self::accrue_protocol_fees(&env);

            events::LiquidityAddedEvent {
                user: from.clone(),
                amount_0,
                amount_1,
                lp_tokens,
            }
            .publish(&env);

            Ok(lp_tokens)
        })
    }

    /// Remove liquidity and burn LP tokens
    pub fn remove_liquidity(
        env: Env,
        user: Address,
        lp_amount: i128,
        min_0: i128,
        min_1: i128,
    ) -> Result<(i128, i128), LiquidityPoolError> {
        user.require_auth();
        if lp_amount <= 0 {
            return Err(LiquidityPoolError::InvalidAmount);
        }

        let user_lp: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserLPBalance(user.clone()))
            .unwrap_or(0);

        if user_lp < lp_amount {
            return Err(LiquidityPoolError::InsufficientBalance);
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
            return Err(LiquidityPoolError::SlippageExceeded);
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
        Self::touch_persistent(&env, &DataKey::Reserve0);
        Self::touch_persistent(&env, &DataKey::Reserve1);
        Self::touch_persistent(&env, &DataKey::LPSupply);
        Self::touch_persistent(&env, &DataKey::UserLPBalance(user.clone()));

        // Transfer tokens
        let token_0_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token0)
            .ok_or(LiquidityPoolError::NotInitialized)?;
        let token_1_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token1)
            .ok_or(LiquidityPoolError::NotInitialized)?;
        Self::touch_instance(&env);

        let token_0 = TokenClient::new(&env, &token_0_addr);
        let token_1 = TokenClient::new(&env, &token_1_addr);

        token_0.transfer(&env.current_contract_address(), &user, &out_0);
        token_1.transfer(&env.current_contract_address(), &user, &out_1);

        events::LiquidityRemovedEvent {
            user: user.clone(),
            lp_tokens: lp_amount,
            amount_0: out_0,
            amount_1: out_1,
        }
        .publish(&env);

        Ok((out_0, out_1))
    }

    /// Swap token_0 for token_1
    pub fn swap_exact_in(
        env: Env,
        from: Address,
        amount_in: i128,
        min_out: i128,
    ) -> Result<i128, LiquidityPoolError> {
        from.require_auth();
        if amount_in <= 0 {
            return Err(LiquidityPoolError::InvalidAmount);
        }

        let token_0_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token0)
            .ok_or(LiquidityPoolError::NotInitialized)?;

        let token_1_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token1)
            .ok_or(LiquidityPoolError::NotInitialized)?;
        Self::touch_instance(&env);

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
            return Err(LiquidityPoolError::SlippageExceeded);
        }

        Self::with_reentrancy_guard(&env, || {
            // Transfer tokens
            let token_0 = TokenClient::new(&env, &token_0_addr);
            let token_1 = TokenClient::new(&env, &token_1_addr);

            token_0.transfer(&from, env.current_contract_address(), &amount_in);
            token_1.transfer(&env.current_contract_address(), &from, &amount_out);

            // Update reserves (fee stays in pool as yield to LPs)
            env.storage()
                .persistent()
                .set(&DataKey::Reserve0, &(reserve_0 + amount_in));
            env.storage()
                .persistent()
                .set(&DataKey::Reserve1, &(reserve_1 - amount_out));
            Self::touch_persistent(&env, &DataKey::Reserve0);
            Self::touch_persistent(&env, &DataKey::Reserve1);

            events::SwapEvent {
                user: from.clone(),
                amount_in,
                amount_out,
            }
            .publish(&env);

            Ok(amount_out)
        })
    }

    /// Integer square root
    fn isqrt(n: u128) -> u128 {
        if n == 0 {
            return 0;
        }
        let mut x = n;
        let mut y = x.div_ceil(2);
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
        let accrued_0 = (reserve_0 * (fee_accrual_bp as i128) * (elapsed as i128))
            / ((365 * 24 * 3600_i128) * 10000);
        let accrued_1 = (reserve_1 * (fee_accrual_bp as i128) * (elapsed as i128))
            / ((365 * 24 * 3600_i128) * 10000);

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
        Self::touch_persistent(env, &DataKey::AccruedFees0);
        Self::touch_persistent(env, &DataKey::AccruedFees1);
        Self::touch_persistent(env, &DataKey::LastFeeAccrual);
    }

    /// Get LP token balance
    pub fn lp_balance(env: Env, user: Address) -> i128 {
        let key = DataKey::UserLPBalance(user);
        let balance = env.storage().persistent().get(&key).unwrap_or(0);
        Self::touch_persistent(&env, &key);
        balance
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
        Self::touch_persistent(&env, &DataKey::Reserve0);
        Self::touch_persistent(&env, &DataKey::Reserve1);
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
        Self::touch_persistent(&env, &DataKey::AccruedFees0);
        Self::touch_persistent(&env, &DataKey::AccruedFees1);
        (f0, f1)
    }
}
