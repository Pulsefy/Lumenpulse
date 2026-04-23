use soroban_sdk::{Address, Env, Symbol};

pub fn get_price(env: &Env, oracle_address: &Address, token: &Address) -> i128 {
    env.invoke_contract::<i128>(
        oracle_address,
        &Symbol::new(env, "get_price"),
        (token.clone(),).into_val(env),
    )
}