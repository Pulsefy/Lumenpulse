//! A minimal token whose `transfer` can be made to trap on demand.
//!
//! The Stellar Asset Contract never fails a funded transfer, so it cannot be
//! used to inject a failure at a specific cross-contract call site. This token
//! implements the subset of the token interface the contracts call
//! (`transfer`, `balance`) and traps any transfer whose recipient matches the
//! configured target, so a test can fail exactly one leg of a multi-transfer
//! sequence.

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
enum Key {
    Balance(Address),
    FailTo,
}

#[contract]
pub struct FaultyToken;

#[contractimpl]
impl FaultyToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let bal = Self::balance(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&Key::Balance(to), &(bal + amount));
    }

    /// Trap every subsequent transfer to `to`; `None` clears the fault.
    pub fn fail_transfers_to(env: Env, to: Option<Address>) {
        match to {
            Some(addr) => env.storage().instance().set(&Key::FailTo, &addr),
            None => env.storage().instance().remove(&Key::FailTo),
        }
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&Key::Balance(id))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let fail_to: Option<Address> = env.storage().instance().get(&Key::FailTo);
        if fail_to.as_ref() == Some(&to) {
            panic!("injected transfer failure");
        }
        let from_bal = Self::balance(env.clone(), from.clone());
        if from_bal < amount {
            panic!("insufficient balance");
        }
        env.storage()
            .persistent()
            .set(&Key::Balance(from), &(from_bal - amount));
        let to_bal = Self::balance(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&Key::Balance(to), &(to_bal + amount));
    }
}
