#![no_std]

mod events;

use events::{AdminChangedEvent, UpgradedEvent};
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env};

/// Storage key enumeration for instance-level state.
#[contracttype]
pub enum DataKey {
    /// The privileged admin / upgrader address.
    Admin,
    /// A simple counter used to demonstrate state preservation across upgrades.
    Counter,
}

#[contract]
pub struct UpgradableContract;

#[contractimpl]
impl UpgradableContract {
    /// Initialise the contract and set the initial `admin`.
    ///
    /// May only be called once. Subsequent calls panic with `"already initialized"`.
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Upgrade the contract WASM to a new hash.
    ///
    /// Only the stored `admin` (governance / multi-sig address) may call this.
    /// Requires `caller` authorization and that `caller` matches the stored admin.
    /// Emits an [`UpgradedEvent`] on success.
    pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        if caller != admin {
            panic!("unauthorized");
        }
        caller.require_auth();

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        UpgradedEvent {
            admin: caller,
            new_wasm_hash,
        }
        .publish(&env);
    }

    /// Transfer the admin role to `new_admin`.
    ///
    /// Simulates governance handoff; in production this would be gated behind
    /// a multi-sig vote. Requires authorization from `current_admin`.
    /// Emits an [`AdminChangedEvent`] on success.
    pub fn set_admin(env: Env, current_admin: Address, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        if current_admin != stored_admin {
            panic!("unauthorized");
        }
        current_admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        AdminChangedEvent {
            old_admin: current_admin,
            new_admin,
        }
        .publish(&env);
    }

    /// Return the current admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    /// Increment the on-chain counter and return its new value.
    pub fn increment(env: Env) -> u32 {
        let mut count: u32 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        count += 1;
        env.storage().instance().set(&DataKey::Counter, &count);
        count
    }

    /// Return the current counter value without mutating state.
    pub fn get_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Counter).unwrap_or(0)
    }

    /// Return this contract's version identifier.
    ///
    /// Bumped to `1` in this enhanced release.
    pub fn version() -> u32 {
        1
    }
}

mod test;
