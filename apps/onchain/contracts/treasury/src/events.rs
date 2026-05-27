use soroban_sdk::{contractevent, Address, Env};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamCreatedEvent {
    #[topic]
    pub beneficiary: Address,
    pub amount: i128,
    pub start_time: u64,
    pub duration: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokensClaimedEvent {
    #[topic]
    pub beneficiary: Address,
    pub amount_claimed: i128,
    pub remaining: i128,
}

pub fn publish_stream_created(
    env: &Env,
    beneficiary: Address,
    amount: i128,
    start_time: u64,
    duration: u64,
) {
    StreamCreatedEvent {
        beneficiary,
        amount,
        start_time,
        duration,
    }
    .publish(env);
}

pub fn publish_tokens_claimed(
    env: &Env,
    beneficiary: Address,
    amount_claimed: i128,
    remaining: i128,
) {
    TokensClaimedEvent {
        beneficiary,
        amount_claimed,
        remaining,
    }
    .publish(env);
}
