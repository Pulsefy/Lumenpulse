#![no_std]

mod events;
mod storage;

use reentrancy_guard::{acquire as acquire_reentrancy, release as release_reentrancy};
use soroban_sdk::token::TokenClient;
use soroban_sdk::{contract, contracterror, contractimpl, Address, Env};
use storage::{DataKey, LEDGER_BUMP, LEDGER_THRESHOLD};

const AMPLIFICATION_FACTOR: i128 = 100; // A parameter for stable swap bonding curve
const SWAP_FEE_BP: u32 = 4; // 0.04% swap fee in basis points
const LP_FEE_BP: u32 = 1; // 0.01% LP fee

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum StableSwapError {
    Reentrancy = 1,
    AlreadyInitialized = 2,
    NotInitialized = 3,
    InvalidAmount = 4,
    SlippageExceeded = 5,
    InsufficientBalance = 6,
}

#[contract]
pub struct StableSwapPoolContract;

#[contractimpl]
impl StableSwapPoolContract {
    fn with_reentrancy_guard<T, F>(env: &Env, f: F) -> Result<T, StableSwapError>
    where
        F: FnOnce() -> Result<T, StableSwapError>,
    {
        acquire_reentrancy(env).map_err(|_| StableSwapError::Reentrancy)?;
        let result = f();
        release_reentrancy(env);
        result
    }

    fn bump_instance(env: &Env) {
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    fn bump_pool_ttl(env: &Env) {
        for key in [DataKey::ReserveA, DataKey::ReserveB, DataKey::LPSupply] {
            if env.storage().persistent().has(&key) {
                env.storage()
                    .persistent()
                    .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
            }
        }
    }

    fn bump_user_lp_ttl(env: &Env, user: &Address) {
        env.storage().persistent().extend_ttl(
            &DataKey::UserLPBalance(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
    }

    pub fn initialize(
        env: Env,
        admin: Address,
        token_a: Address,
        token_b: Address,
    ) -> Result<(), StableSwapError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(StableSwapError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenA, &token_a);
        env.storage().instance().set(&DataKey::TokenB, &token_b);
        Self::bump_instance(&env);

        events::PoolInitializedEvent {
            admin,
            token_a,
            token_b,
        }
        .publish(&env);

        Ok(())
    }

    pub fn add_liquidity(
        env: Env,
        user: Address,
        amount_a: i128,
        amount_b: i128,
        min_lp: i128,
    ) -> Result<i128, StableSwapError> {
        user.require_auth();
        Self::with_reentrancy_guard(&env, || {
            if amount_a <= 0 || amount_b <= 0 {
                return Err(StableSwapError::InvalidAmount);
            }

            Self::bump_instance(&env);

            let token_a_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::TokenA)
                .ok_or(StableSwapError::NotInitialized)?;

            let token_b_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::TokenB)
                .ok_or(StableSwapError::NotInitialized)?;

            let token_a = TokenClient::new(&env, &token_a_addr);
            let token_b = TokenClient::new(&env, &token_b_addr);

            token_a.transfer(&user, &env.current_contract_address(), &amount_a);
            token_b.transfer(&user, &env.current_contract_address(), &amount_b);

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
                Self::isqrt((amount_a * amount_b) as u128) as i128
            } else {
                let token_a_contribution = (amount_a * lp_supply) / (reserve_a + 1);
                let token_b_contribution = (amount_b * lp_supply) / (reserve_b + 1);
                if token_a_contribution < token_b_contribution {
                    token_a_contribution
                } else {
                    token_b_contribution
                }
            };

            if lp_tokens < min_lp {
                return Err(StableSwapError::SlippageExceeded);
            }

            let new_reserve_a = reserve_a + amount_a;
            let new_reserve_b = reserve_b + amount_b;
            env.storage()
                .persistent()
                .set(&DataKey::ReserveA, &new_reserve_a);
            env.storage()
                .persistent()
                .set(&DataKey::ReserveB, &new_reserve_b);

            let new_lp_supply = lp_supply + lp_tokens;
            env.storage()
                .persistent()
                .set(&DataKey::LPSupply, &new_lp_supply);

            let user_lp: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::UserLPBalance(user.clone()))
                .unwrap_or(0);
            env.storage().persistent().set(
                &DataKey::UserLPBalance(user.clone()),
                &(user_lp + lp_tokens),
            );
            Self::bump_pool_ttl(&env);
            Self::bump_user_lp_ttl(&env, &user);

            events::LiquidityAddedEvent {
                user,
                amount_a,
                amount_b,
                lp_tokens,
            }
            .publish(&env);

            Ok(lp_tokens)
        })
    }

    pub fn remove_liquidity(
        env: Env,
        user: Address,
        lp_amount: i128,
        min_a: i128,
        min_b: i128,
    ) -> Result<(i128, i128), StableSwapError> {
        user.require_auth();
        if lp_amount <= 0 {
            return Err(StableSwapError::InvalidAmount);
        }

        Self::bump_instance(&env);

        let user_lp: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserLPBalance(user.clone()))
            .unwrap_or(0);

        if user_lp < lp_amount {
            return Err(StableSwapError::InsufficientBalance);
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

        let out_a = (lp_amount * reserve_a) / lp_supply;
        let out_b = (lp_amount * reserve_b) / lp_supply;

        if out_a < min_a || out_b < min_b {
            return Err(StableSwapError::SlippageExceeded);
        }

        env.storage()
            .persistent()
            .set(&DataKey::ReserveA, &(reserve_a - out_a));
        env.storage()
            .persistent()
            .set(&DataKey::ReserveB, &(reserve_b - out_b));

        env.storage()
            .persistent()
            .set(&DataKey::LPSupply, &(lp_supply - lp_amount));

        env.storage().persistent().set(
            &DataKey::UserLPBalance(user.clone()),
            &(user_lp - lp_amount),
        );
        Self::bump_pool_ttl(&env);
        Self::bump_user_lp_ttl(&env, &user);

        let token_a_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenA)
            .ok_or(StableSwapError::NotInitialized)?;
        let token_b_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenB)
            .ok_or(StableSwapError::NotInitialized)?;

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

    pub fn swap(
        env: Env,
        user: Address,
        input_token: Address,
        amount_in: i128,
        min_out: i128,
    ) -> Result<i128, StableSwapError> {
        user.require_auth();
        if amount_in <= 0 {
            return Err(StableSwapError::InvalidAmount);
        }

        Self::bump_instance(&env);

        let token_a_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenA)
            .ok_or(StableSwapError::NotInitialized)?;
        let token_b_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenB)
            .ok_or(StableSwapError::NotInitialized)?;

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

        let amount_after_fee = (amount_in * (10000 - SWAP_FEE_BP as i128)) / 10000;
        let amount_out = (reserve_out * amount_after_fee) / (reserve_in + amount_after_fee);

        if amount_out < min_out {
            return Err(StableSwapError::SlippageExceeded);
        }

        Self::with_reentrancy_guard(&env, || {
            let token_in = TokenClient::new(&env, &input_token);
            token_in.transfer(&user, &env.current_contract_address(), &amount_in);

            if input_token == token_a_addr {
                let new_ra = reserve_in + amount_in;
                let new_rb = reserve_out - amount_out;
                env.storage().persistent().set(&DataKey::ReserveA, &new_ra);
                env.storage().persistent().set(&DataKey::ReserveB, &new_rb);
            } else {
                let new_rb = reserve_in + amount_in;
                let new_ra = reserve_out - amount_out;
                env.storage().persistent().set(&DataKey::ReserveB, &new_rb);
                env.storage().persistent().set(&DataKey::ReserveA, &new_ra);
            }
            Self::bump_pool_ttl(&env);

            let token_out = TokenClient::new(&env, &output_token);
            token_out.transfer(&env.current_contract_address(), &user, &amount_out);

            events::SwapEvent {
                user,
                input_token,
                amount_in,
                output_token,
                amount_out,
            }
            .publish(&env);

            Ok(amount_out)
        })
    }

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

    pub fn lp_balance(env: Env, user: Address) -> i128 {
        let key = DataKey::UserLPBalance(user.clone());
        let balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        balance
    }

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
        Self::bump_pool_ttl(&env);
        (ra, rb)
    }
}

#[cfg(test)]
mod test;

