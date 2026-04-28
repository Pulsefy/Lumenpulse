use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamCreatedEvent {
    pub beneficiary: Address,
    pub amount: i128,
    pub start_time: u64,
    pub duration: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokensClaimedEvent {
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
    env.events().publish(
        ("Treasury", "stream_created", beneficiary.clone()),
        StreamCreatedEvent {
            beneficiary,
            amount,
            start_time,
            duration,
        },
    );
}

pub fn publish_tokens_claimed(
    env: &Env,
    beneficiary: Address,
    amount_claimed: i128,
    remaining: i128,
) {
    env.events().publish(
        ("Treasury", "tokens_claimed", beneficiary.clone()),
        TokensClaimedEvent {
            beneficiary,
            amount_claimed,
            remaining,
        },
    );
}
