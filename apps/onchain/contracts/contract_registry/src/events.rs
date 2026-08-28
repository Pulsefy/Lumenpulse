use soroban_sdk::{Address, Env, Symbol, symbol_short, contracttype};

#[contracttype]
#[derive(Clone)]
pub struct InitializedEvent {
    pub admin: Address,
}

impl InitializedEvent {
    pub fn publish(&self, env: &Env) {
        env.events().publish((symbol_short!("init"),), self.clone());
    }
}

#[contracttype]
#[derive(Clone)]
pub struct ContractRegisteredEvent {
    pub key: Symbol,
    pub address: Address,
    pub version: u32,
    pub env: Symbol,
}

impl ContractRegisteredEvent {
    pub fn publish(&self, env: &Env) {
        env.events().publish((symbol_short!("reg"),), self.clone());
    }
}

#[contracttype]
#[derive(Clone)]
pub struct ContractUpdatedEvent {
    pub key: Symbol,
    pub version: u32,
    pub env: Symbol,
}

impl ContractUpdatedEvent {
    pub fn publish(&self, env: &Env) {
        env.events().publish((symbol_short!("upd"),), self.clone());
    }
}
