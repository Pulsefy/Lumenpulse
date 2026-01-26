use soroban_sdk::{Address, Env};

/// Transfer tokens from one address to another
pub fn transfer(env: &Env, token: &Address, from: &Address, to: &Address, amount: &i128) {
    let token_client = soroban_sdk::token::Client::new(env, token);
    token_client.transfer(from, to, amount);
}

/// Get the balance of an address for a given token
#[allow(dead_code)]
pub fn balance(env: &Env, token: &Address, address: &Address) -> i128 {
    let token_client = soroban_sdk::token::Client::new(env, token);
    token_client.balance(address)
}
