use soroban_sdk::{contractevent, Address};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolInitializedEvent {
    pub admin: Address,
    pub token_a: Address,
    pub token_b: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiquidityAddedEvent {
    #[topic]
    pub user: Address,
    pub amount_a: i128,
    pub amount_b: i128,
    pub lp_tokens: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiquidityRemovedEvent {
    #[topic]
    pub user: Address,
    pub lp_tokens: i128,
    pub amount_a: i128,
    pub amount_b: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwapEvent {
    #[topic]
    pub user: Address,
    pub input_token: Address,
    pub amount_in: i128,
    pub output_token: Address,
    pub amount_out: i128,
}
