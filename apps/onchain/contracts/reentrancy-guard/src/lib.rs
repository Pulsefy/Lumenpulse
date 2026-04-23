#![no_std]

use soroban_sdk::{contracttype, Env, Symbol};

const REENTRANCY_GUARD_KEY: &str = "reentrancy_guard";

#[contracttype]
#[derive(Clone)]
pub struct ReentrancyGuard {
    env: Env,
}

impl ReentrancyGuard {
    pub fn enter(env: &Env) -> Result<Self, ()> {
        let key = Symbol::new(env, REENTRANCY_GUARD_KEY);
        let active: bool = env.storage().instance().get(&key).unwrap_or(false);
        if active {
            return Err(());
        }
        env.storage().instance().set(&key, &true);
        Ok(Self { env: env.clone() })
    }
}

impl Drop for ReentrancyGuard {
    fn drop(&mut self) {
        let key = Symbol::new(&self.env, REENTRANCY_GUARD_KEY);
        self.env.storage().instance().set(&key, &false);
    }
}
