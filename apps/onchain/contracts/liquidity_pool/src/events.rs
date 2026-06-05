use soroban_sdk::{contractevent, Address};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolInitializedEvent {
    pub admin: Address,
    pub token_0: Address,
    pub token_1: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiquidityAddedEvent {
    #[topic]
    pub user: Address,
    pub amount_0: i128,
    pub amount_1: i128,
    pub lp_tokens: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiquidityRemovedEvent {
    #[topic]
    pub user: Address,
    pub lp_tokens: i128,
    pub amount_0: i128,
    pub amount_1: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwapEvent {
    #[topic]
    pub user: Address,
    pub amount_in: i128,
    pub amount_out: i128,
}
