#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};

#[contract]
pub struct PriceOracleContract;

#[contractimpl]
impl PriceOracleContract {
    /// Initialize the oracle with an admin
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&Symbol::new(&env, "admin"), &admin);
    }

    /// Set price for a token in XLM (price is amount of XLM per token unit, scaled by 1e7 for precision)
    /// For example, if 1 token = 0.5 XLM, set price = 5000000
    pub fn set_price(env: Env, admin: Address, token: Address, price: i128) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&Symbol::new(&env, "admin")).unwrap();
        assert!(admin == stored_admin, "Unauthorized");

        env.storage().instance().set(&token, &price);
    }

    /// Get price for a token in XLM
    pub fn get_price(env: Env, token: Address) -> i128 {
        env.storage().instance().get(&token).unwrap_or(0)
    }

    /// Get admin
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&Symbol::new(&env, "admin")).unwrap()
    }
}