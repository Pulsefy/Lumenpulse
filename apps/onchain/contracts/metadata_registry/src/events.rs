use soroban_sdk::{Address, Env, String, Symbol};

pub struct InitializedEvent {
    pub admin: Address,
}

impl InitializedEvent {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "metadata_registry"), Symbol::new(env, "initialized")),
            self.admin.clone(),
        );
    }
}

pub struct MetadataUpdatedEvent {
    pub key: String,
    pub address: Address,
    pub version: String,
    pub environment: String,
}

impl MetadataUpdatedEvent {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "metadata_registry"), Symbol::new(env, "updated")),
            (self.key.clone(), self.address.clone(), self.version.clone(), self.environment.clone()),
        );
    }
}
