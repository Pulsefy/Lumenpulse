#![no_std]

mod admin;
mod allowance;
mod balance;
mod events;
mod metadata;
mod test;

use events::{AdminChangedEvent, BurnEvent, UpgradedEvent};
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, String};

#[contract]
pub struct LumenToken;

#[contractimpl]
impl LumenToken {
    pub fn initialize(e: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if admin::has_administrator(&e) {
            panic!("already initialized");
        }
        admin::write_administrator(&e, &admin);
        metadata::write_metadata(&e, decimal, name, symbol);
    }

    pub fn mint(e: Env, to: Address, amount: i128) {
        let admin = admin::read_administrator(&e);
        admin.require_auth();
        balance::receive_balance(&e, to, amount);
    }

    /// Transfer the admin role to `new_admin`. Emits [`AdminChangedEvent`].
    pub fn set_admin(e: Env, new_admin: Address) {
        let old_admin = admin::read_administrator(&e);
        old_admin.require_auth();
        admin::write_administrator(&e, &new_admin);
        AdminChangedEvent {
            old_admin,
            new_admin,
        }
        .publish(&e);
    }

    pub fn freeze(e: Env, id: Address) {
        let admin = admin::read_administrator(&e);
        admin.require_auth();
        balance::write_state(&e, id, true);
    }

    pub fn unfreeze(e: Env, id: Address) {
        let admin = admin::read_administrator(&e);
        admin.require_auth();
        balance::write_state(&e, id, false);
    }

    pub fn allowance(e: Env, from: Address, spender: Address) -> i128 {
        allowance::read_allowance(&e, from, spender).amount
    }

    pub fn approve(e: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();
        balance::check_not_frozen(&e, &from);
        allowance::write_allowance(&e, from, spender, amount, expiration_ledger);
    }

    pub fn balance(e: Env, id: Address) -> i128 {
        balance::read_balance(&e, id)
    }

    pub fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        balance::spend_balance(&e, from.clone(), amount);
        balance::receive_balance(&e, to, amount);
    }

    pub fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        balance::check_not_frozen(&e, &spender);

        allowance::spend_allowance(&e, from.clone(), spender, amount);
        balance::spend_balance(&e, from.clone(), amount);
        balance::receive_balance(&e, to, amount);
    }

    pub fn burn(e: Env, from: Address, amount: i128) {
        from.require_auth();
        balance::check_not_frozen(&e, &from);
        balance::spend_balance(&e, from.clone(), amount);
        BurnEvent { from, amount }.publish(&e);
    }

    pub fn burn_from(e: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        balance::check_not_frozen(&e, &spender);
        allowance::spend_allowance(&e, from.clone(), spender, amount);
        balance::spend_balance(&e, from.clone(), amount);
        BurnEvent { from, amount }.publish(&e);
    }

    pub fn decimals(e: Env) -> u32 {
        metadata::read_decimal(&e)
    }

    pub fn name(e: Env) -> String {
        metadata::read_name(&e)
    }

    pub fn symbol(e: Env) -> String {
        metadata::read_symbol(&e)
    }

    /// Upgrade the contract WASM to a new hash.
    ///
    /// Only the stored admin may call this. Emits [`UpgradedEvent`] on success.
    pub fn upgrade(e: Env, caller: Address, new_wasm_hash: BytesN<32>) {
        let admin = admin::read_administrator(&e);
        if caller != admin {
            panic!("unauthorized");
        }
        caller.require_auth();
        e.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        UpgradedEvent {
            admin: caller,
            new_wasm_hash,
        }
        .publish(&e);
    }
}
