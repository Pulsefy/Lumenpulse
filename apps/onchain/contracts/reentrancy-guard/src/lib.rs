#![no_std]

use soroban_sdk::{contracterror, symbol_short, Env, Symbol};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum GuardError {
    Reentrancy = 1,
}

const REENTRANCY_KEY: Symbol = symbol_short!("REENTRANT");

pub fn acquire(env: &Env) -> Result<(), GuardError> {
    if env
        .storage()
        .instance()
        .get(&REENTRANCY_KEY)
        .unwrap_or(false)
    {
        return Err(GuardError::Reentrancy);
    }

    env.storage().instance().set(&REENTRANCY_KEY, &true);
    Ok(())
}

pub fn release(env: &Env) {
    env.storage().instance().set(&REENTRANCY_KEY, &false);
}

pub fn is_entered(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&REENTRANCY_KEY)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{acquire, is_entered, release, GuardError};
    use soroban_sdk::{contract, contractimpl, Env};

    #[contract]
    struct DummyContract;

    #[contractimpl]
    impl DummyContract {
        pub fn ping(_env: Env) {}
    }

    fn with_contract_env<F>(f: F)
    where
        F: FnOnce(&Env),
    {
        let env = Env::default();
        let contract_id = env.register(DummyContract, ());
        env.as_contract(&contract_id, || f(&env));
    }

    #[test]
    fn acquire_succeeds_when_not_held() {
        with_contract_env(|env| {
            assert_eq!(acquire(env), Ok(()));
            assert!(is_entered(env));
        });
    }

    #[test]
    fn acquire_fails_when_already_held() {
        with_contract_env(|env| {
            assert_eq!(acquire(env), Ok(()));
            assert_eq!(acquire(env), Err(GuardError::Reentrancy));
        });
    }

    #[test]
    fn release_clears_lock() {
        with_contract_env(|env| {
            assert_eq!(acquire(env), Ok(()));
            release(env);
            assert!(!is_entered(env));
            assert_eq!(acquire(env), Ok(()));
        });
    }

    #[test]
    fn fresh_env_without_key_is_not_entered() {
        with_contract_env(|env| {
            assert!(!is_entered(env));
            assert_eq!(acquire(env), Ok(()));
        });
    }
}
