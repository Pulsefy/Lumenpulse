#![no_std]

mod events;
mod storage;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contracterror, contractimpl, Address, Env};
use soroban_sdk::token::TokenClient;
use storage::DataKey;
use reentrancy_guard::{acquire as acquire_reentrancy, release as release_reentrancy};

const AMPLIFICATION_FACTOR: i128 = 100; // A parameter for stable swap bonding curve
const SWAP_FEE_BP: u32 = 4; // 0.04% swap fee in basis points
const LP_FEE_BP: u32 = 1; // 0.01% LP fee

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum StableSwapPoolError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    SlippageExceeded = 4,
    InsufficientBalance = 5,
    Reentrancy = 6,
}

#[contract]
pub struct StableSwapPoolContract;

/// Mock Curve-like Stable Swap Pool
/// - Stable coin swaps with low slippage
/// - Yield from trading fees
/// - LP token minting
/// - AMM-based pricing
#[contractimpl]
impl StableSwapPoolContract {
    fn with_reentrancy_guard<T, F>(env: &Env, f: F) -> Result<T, StableSwapPoolError>
    where
        F: FnOnce() -> Result<T, StableSwapPoolError>,
    {
        acquire_reentrancy(env).map_err(|_| StableSwapPoolError::Reentrancy)?;
        let result = f();
        release_reentrancy(env);
        result
    }

    /// Initialize pool with two stable tokens
    pub fn initialize(
        env: Env,
        admin: Address,
        token_a: Address,
        token_b: Address,
    ) -> Result<(), StableSwapPoolError> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(StableSwapPoolError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::TokenA, &token_a);
        env.storage()
            .instance()
            .set(&DataKey::TokenB, &token_b);
        env.storage().instance().extend_ttl(100, 100);

        events::PoolInitializedEvent {
            admin,
            token_a,
            token_b,
        }
        .publish(&env);

        Ok(())
    }

    /// Add liquidity to the pool (both tokens)
    /// Returns LP tokens minted
    pub fn add_liquidity(
        env: Env,
        user: Address,
        amount_a: i128,
        amount_b: i128,
        min_lp: i128,
    ) -> Result<i128, StableSwapPoolError> {
        user.require_auth();
        Self::with_reentrancy_guard(&env, || {
            if amount_a <= 0 || amount_b <= 0 {
                return Err(StableSwapPoolError::InvalidAmount);
            }

            let token_a_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::TokenA)
                .ok_or(StableSwapPoolError::NotInitialized)?;

            let token_b_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::TokenB)
                .ok_or(StableSwapPoolError::NotInitialized)?;

            // Transfer tokens from caller
            let token_a = TokenClient::new(&env, &token_a_addr);
            let token_b = TokenClient::new(&env, &token_b_addr);

            token_a.transfer(&user, &env.current_contract_address(), &amount_a);
            token_b.transfer(&user, &env.current_contract_address(), &amount_b);

            // Calculate LP tokens
            let lp_supply: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::LPSupply)
                .unwrap_or(0);

            let reserve_a: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::ReserveA)
                .unwrap_or(0);

            let reserve_b: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::ReserveB)
                .unwrap_or(0);

            let lp_tokens = if lp_supply == 0 {
                // First liquidity: geometric mean
                Self::isqrt((amount_a * amount_b) as u128) as i128
            } else {
                // New LP tokens proportional to shares
                let token_a_contribution = (amount_a * lp_supply) / (reserve_a + 1);
                let token_b_contribution = (amount_b * lp_supply) / (reserve_b + 1);
                if token_a_contribution < token_b_contribution {
                    token_a_contribution
                } else {
                    token_b_contribution
                }
            };

            if lp_tokens < min_lp {
                return Err(StableSwapPoolError::SlippageExceeded);
            }

            // Update reserves
            let new_reserve_a = reserve_a + amount_a;
            let new_reserve_b = reserve_b + amount_b;
            env.storage()
                .persistent()
                .set(&DataKey::ReserveA, &new_reserve_a);
            env.storage()
                .persistent()
                .set(&DataKey::ReserveB, &new_reserve_b);

            // Update LP supply
            let new_lp_supply = lp_supply + lp_tokens;
            env.storage()
                .persistent()
                .set(&DataKey::LPSupply, &new_lp_supply);

            // Track user LP tokens
            let user_lp: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::UserLPBalance(user.clone()))
                .unwrap_or(0);
            env.storage().persistent().set(
                &DataKey::UserLPBalance(user.clone()),
                &(user_lp + lp_tokens),
            );

            events::LiquidityAddedEvent {
                user: user.clone(),
                amount_a,
                amount_b,
                lp_tokens,
            }
            .publish(&env);

            Ok(lp_tokens)
        })
    }

    /// Remove liquidity (both tokens proportionally)
    pub fn remove_liquidity(
        env: Env,
        user: Address,
        lp_amount: i128,
        min_a: i128,
        min_b: i128,
    ) -> Result<(i128, i128), StableSwapPoolError> {
        user.require_auth();
        if lp_amount <= 0 {
            return Err(StableSwapPoolError::InvalidAmount);
        }

        let user_lp: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserLPBalance(user.clone()))
            .unwrap_or(0);

        if user_lp < lp_amount {
            return Err(StableSwapPoolError::InsufficientBalance);
        }

        let lp_supply: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::LPSupply)
            .unwrap_or(0);

        let reserve_a: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::ReserveA)
            .unwrap_or(0);

        let reserve_b: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::ReserveB)
            .unwrap_or(0);

        // Calculate output amounts
        let out_a = (lp_amount * reserve_a) / lp_supply;
        let out_b = (lp_amount * reserve_b) / lp_supply;

        if out_a < min_a || out_b < min_b {
            return Err(StableSwapPoolError::SlippageExceeded);
        }

        // Update reserves
        env.storage()
            .persistent()
            .set(&DataKey::ReserveA, &(reserve_a - out_a));
        env.storage()
            .persistent()
            .set(&DataKey::ReserveB, &(reserve_b - out_b));

        // Update LP supply
        env.storage()
            .persistent()
            .set(&DataKey::LPSupply, &(lp_supply - lp_amount));

        // Update user balance
        env.storage().persistent().set(
            &DataKey::UserLPBalance(user.clone()),
            &(user_lp - lp_amount),
        );

        // Transfer tokens
        let token_a_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenA)
            .ok_or(StableSwapPoolError::NotInitialized)?;
        let token_b_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenB)
            .ok_or(StableSwapPoolError::NotInitialized)?;

        let token_a = TokenClient::new(&env, &token_a_addr);
        let token_b = TokenClient::new(&env, &token_b_addr);

        token_a.transfer(&env.current_contract_address(), &user, &out_a);
        token_b.transfer(&env.current_contract_address(), &user, &out_b);

        events::LiquidityRemovedEvent {
            user,
            lp_tokens: lp_amount,
            amount_a: out_a,
            amount_b: out_b,
        }
        .publish(&env);

        Ok((out_a, out_b))
    }

    /// Swap tokens (A -> B or B -> A)
    pub fn swap(
        env: Env,
        user: Address,
        input_token: Address,
        amount_in: i128,
        min_out: i128,
    ) -> Result<i128, StableSwapPoolError> {
        user.require_auth();
        if amount_in <= 0 {
            return Err(StableSwapPoolError::InvalidAmount);
        }

        let token_a_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenA)
            .ok_or(StableSwapPoolError::NotInitialized)?;
        let token_b_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenB)
            .ok_or(StableSwapPoolError::NotInitialized)?;

        let (reserve_in, reserve_out, output_token) = if input_token == token_a_addr {
            let ra: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::ReserveA)
                .unwrap_or(0);
            let rb: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::ReserveB)
                .unwrap_or(0);
            (ra, rb, token_b_addr.clone())
        } else {
            let rb: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::ReserveB)
                .unwrap_or(0);
            let ra: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::ReserveA)
                .unwrap_or(0);
            (rb, ra, token_a_addr.clone())
        };

        // Apply swap fee
        let amount_after_fee = (amount_in * (10000 - SWAP_FEE_BP as i128)) / 10000;

        // Stable swap formula: x³y + y³x ≥ k (simplified to constant product-like)
        let amount_out = (reserve_out * amount_after_fee) / (reserve_in + amount_after_fee);

        if amount_out < min_out {
            return Err(StableSwapPoolError::SlippageExceeded);
        }

        Self::with_reentrancy_guard(&env, || {
            // Transfer input tokens from caller
            let token_in = TokenClient::new(&env, &input_token);
            token_in.transfer(&user, &env.current_contract_address(), &amount_in);

            // Update reserves
            if input_token == token_a_addr {
                let new_ra = reserve_in + amount_in;
                let new_rb = reserve_out - amount_out;
                env.storage()
                    .persistent()
                    .set(&DataKey::ReserveA, &new_ra);
                env.storage()
                    .persistent()
                    .set(&DataKey::ReserveB, &new_rb);
            } else {
                let new_rb = reserve_in + amount_in;
                let new_ra = reserve_out - amount_out;
                env.storage()
                    .persistent()
                    .set(&DataKey::ReserveB, &new_rb);
                env.storage()
                    .persistent()
                    .set(&DataKey::ReserveA, &new_ra);
            }

            // Transfer output tokens to caller
            let token_out = TokenClient::new(&env, &output_token);
            token_out.transfer(&env.current_contract_address(), &user, &amount_out);

            events::SwapEvent {
                user: user.clone(),
                input_token,
                amount_in,
                output_token,
                amount_out,
            }
            .publish(&env);

            Ok(amount_out)
        })
    }

    /// Integer square root (for geometric mean calculation)
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

    /// Get LP token balance
    pub fn lp_balance(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::UserLPBalance(user))
            .unwrap_or(0)
    }

    /// Get current reserves
    pub fn get_reserves(env: Env) -> (i128, i128) {
        let ra: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::ReserveA)
            .unwrap_or(0);
        let rb: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::ReserveB)
            .unwrap_or(0);
        (ra, rb)
    }
}
