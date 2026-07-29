use soroban_sdk::{contractevent, Address, Env, Symbol};

pub const EVENT_VERSION_INITIALIZED: u32 = 1u32;
pub const EVENT_VERSION_ROUND_CREATED: u32 = 1u32;
pub const EVENT_VERSION_POOL_FUNDED: u32 = 1u32;
pub const EVENT_VERSION_PROJECT_APPROVED: u32 = 1u32;
pub const EVENT_VERSION_PROJECT_REMOVED: u32 = 1u32;
pub const EVENT_VERSION_CONTRIBUTION_RECORDED: u32 = 1u32;
pub const EVENT_VERSION_ROUND_FINALIZED: u32 = 1u32;
pub const EVENT_VERSION_MATCH_DISTRIBUTED: u32 = 1u32;
pub const EVENT_VERSION_ALL_MATCHES_DISTRIBUTED: u32 = 1u32;
pub const EVENT_VERSION_ROUND_CAP_UPDATED: u32 = 1u32;

pub mod schema_ids {
    use super::*;

    pub fn initialized_v1(env: &Env) -> Symbol {
        Symbol::new(env, "sys.initialized.v1")
    }

    pub fn round_created_v1(env: &Env) -> Symbol {
        Symbol::new(env, "pool.round_created.v1")
    }

    pub fn pool_funded_v1(env: &Env) -> Symbol {
        Symbol::new(env, "pool.funded.v1")
    }

    pub fn project_approved_v1(env: &Env) -> Symbol {
        Symbol::new(env, "pool.project_approved.v1")
    }

    pub fn project_removed_v1(env: &Env) -> Symbol {
        Symbol::new(env, "pool.project_removed.v1")
    }

    pub fn contribution_recorded_v1(env: &Env) -> Symbol {
        Symbol::new(env, "pool.contribution_recorded.v1")
    }

    pub fn round_finalized_v1(env: &Env) -> Symbol {
        Symbol::new(env, "pool.round_finalized.v1")
    }

    pub fn match_distributed_v1(env: &Env) -> Symbol {
        Symbol::new(env, "pool.match_distributed.v1")
    }

    pub fn all_matches_distributed_v1(env: &Env) -> Symbol {
        Symbol::new(env, "pool.all_matches_distributed.v1")
    }

    pub fn round_cap_updated_v1(env: &Env) -> Symbol {
        Symbol::new(env, "pool.cap_updated.v1")
    }
}

#[contractevent]
pub struct InitializedEvent {
    pub admin: Address,
    pub version: u32,
    pub schema_id: Symbol,
}

#[contractevent]
pub struct RoundCreatedEvent {
    #[topic]
    pub admin: Address,
    pub round_id: u64,
    pub name: Symbol,
    pub start_time: u64,
    pub end_time: u64,
    pub version: u32,
    pub schema_id: Symbol,
}

#[contractevent]
pub struct PoolFundedEvent {
    #[topic]
    pub funder: Address,
    #[topic]
    pub round_id: u64,
    pub amount: i128,
    pub version: u32,
    pub schema_id: Symbol,
}

#[contractevent]
pub struct ProjectApprovedEvent {
    #[topic]
    pub round_id: u64,
    pub project_id: u64,
    pub version: u32,
    pub schema_id: Symbol,
}

#[contractevent]
pub struct ProjectRemovedEvent {
    #[topic]
    pub round_id: u64,
    pub project_id: u64,
    pub version: u32,
    pub schema_id: Symbol,
}

#[contractevent]
pub struct ContributionRecordedEvent {
    #[topic]
    pub round_id: u64,
    #[topic]
    pub project_id: u64,
    pub contributor: Address,
    pub amount: i128,
    pub version: u32,
    pub schema_id: Symbol,
}

#[contractevent]
pub struct RoundFinalizedEvent {
    #[topic]
    pub round_id: u64,
    pub admin: Address,
    pub finalized_at: u64,
    pub version: u32,
    pub schema_id: Symbol,
}

#[contractevent]
pub struct MatchDistributedEvent {
    #[topic]
    pub round_id: u64,
    pub project_id: u64,
    pub match_amount: i128,
    pub version: u32,
    pub schema_id: Symbol,
}

#[contractevent]
pub struct AllMatchesDistributedEvent {
    #[topic]
    pub round_id: u64,
    pub total_distributed: i128,
    pub version: u32,
    pub schema_id: Symbol,
}

#[contractevent]
pub struct RoundCapUpdatedEvent {
    #[topic]
    pub admin: Address,
    #[topic]
    pub round_id: u64,
    pub cap: i128,
    pub version: u32,
    pub schema_id: Symbol,
}

pub fn publish_initialized(env: &Env, admin: Address) {
    InitializedEvent {
        admin,
        version: EVENT_VERSION_INITIALIZED,
        schema_id: schema_ids::initialized_v1(env),
    }
    .publish(env);
}

pub fn publish_round_created(
    env: &Env,
    admin: Address,
    round_id: u64,
    name: Symbol,
    start_time: u64,
    end_time: u64,
) {
    RoundCreatedEvent {
        admin,
        round_id,
        name,
        start_time,
        end_time,
        version: EVENT_VERSION_ROUND_CREATED,
        schema_id: schema_ids::round_created_v1(env),
    }
    .publish(env);
}

pub fn publish_pool_funded(
    env: &Env,
    funder: Address,
    round_id: u64,
    amount: i128,
) {
    PoolFundedEvent {
        funder,
        round_id,
        amount,
        version: EVENT_VERSION_POOL_FUNDED,
        schema_id: schema_ids::pool_funded_v1(env),
    }
    .publish(env);
}

pub fn publish_project_approved(env: &Env, round_id: u64, project_id: u64) {
    ProjectApprovedEvent {
        round_id,
        project_id,
        version: EVENT_VERSION_PROJECT_APPROVED,
        schema_id: schema_ids::project_approved_v1(env),
    }
    .publish(env);
}

pub fn publish_project_removed(env: &Env, round_id: u64, project_id: u64) {
    ProjectRemovedEvent {
        round_id,
        project_id,
        version: EVENT_VERSION_PROJECT_REMOVED,
        schema_id: schema_ids::project_removed_v1(env),
    }
    .publish(env);
}

pub fn publish_contribution_recorded(
    env: &Env,
    round_id: u64,
    project_id: u64,
    contributor: Address,
    amount: i128,
) {
    ContributionRecordedEvent {
        round_id,
        project_id,
        contributor,
        amount,
        version: EVENT_VERSION_CONTRIBUTION_RECORDED,
        schema_id: schema_ids::contribution_recorded_v1(env),
    }
    .publish(env);
}

pub fn publish_round_finalized(
    env: &Env,
    round_id: u64,
    admin: Address,
    finalized_at: u64,
) {
    RoundFinalizedEvent {
        round_id,
        admin,
        finalized_at,
        version: EVENT_VERSION_ROUND_FINALIZED,
        schema_id: schema_ids::round_finalized_v1(env),
    }
    .publish(env);
}

pub fn publish_match_distributed(
    env: &Env,
    round_id: u64,
    project_id: u64,
    match_amount: i128,
) {
    MatchDistributedEvent {
        round_id,
        project_id,
        match_amount,
        version: EVENT_VERSION_MATCH_DISTRIBUTED,
        schema_id: schema_ids::match_distributed_v1(env),
    }
    .publish(env);
}

pub fn publish_all_matches_distributed(
    env: &Env,
    round_id: u64,
    total_distributed: i128,
) {
    AllMatchesDistributedEvent {
        round_id,
        total_distributed,
        version: EVENT_VERSION_ALL_MATCHES_DISTRIBUTED,
        schema_id: schema_ids::all_matches_distributed_v1(env),
    }
    .publish(env);
}

pub fn publish_round_cap_updated(
    env: &Env,
    admin: Address,
    round_id: u64,
    cap: i128,
) {
    RoundCapUpdatedEvent {
        admin,
        round_id,
        cap,
        version: EVENT_VERSION_ROUND_CAP_UPDATED,
        schema_id: schema_ids::round_cap_updated_v1(env),
    }
    .publish(env);
}
