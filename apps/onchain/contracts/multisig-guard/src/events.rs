use soroban_sdk::{Address, Env, Symbol, Val, Vec};
use crate::storage::ProposalStatus;

pub fn publish_multisig_configured(
    env: &Env,
    bootstrapper: Address,
    threshold: u32,
    signer_count: u32,
) {
    #[allow(deprecated)]
    env.events().publish(
        (Symbol::new(env, "multisig_configured"),),
        (bootstrapper, threshold, signer_count),
    );
}

pub fn publish_proposal_created(
    env: &Env,
    proposal_id: u64,
    proposer: Address,
    action: Vec<Val>,
    weight: u32,
    threshold: u32,
) {
    #[allow(deprecated)]
    env.events().publish(
        (Symbol::new(env, "proposal_created"), proposal_id),
        (proposer, action, weight, threshold),
    );
}

pub fn publish_signature_collected(
    env: &Env,
    proposal_id: u64,
    signer: Address,
    weight: u32,
    threshold: u32,
    status: ProposalStatus,
) {
    #[allow(deprecated)]
    env.events().publish(
        (Symbol::new(env, "signature_collected"), proposal_id),
        (signer, weight, threshold, status as u32),
    );
}

pub fn publish_proposal_executed(
    env: &Env,
    proposal_id: u64,
    executor: Address,
    action: Vec<Val>,
) {
    #[allow(deprecated)]
    env.events().publish(
        (Symbol::new(env, "proposal_executed"), proposal_id),
        (executor, action),
    );
}

pub fn publish_proposal_cancelled(env: &Env, proposal_id: u64, canceller: Address) {
    #[allow(deprecated)]
    env.events().publish(
        (Symbol::new(env, "proposal_cancelled"), proposal_id),
        canceller,
    );
}
