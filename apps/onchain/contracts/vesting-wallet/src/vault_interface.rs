use soroban_sdk::{contractclient, Env};

#[allow(dead_code)]
#[contractclient(name = "CrowdfundVaultClient")]
pub trait CrowdfundVaultTrait {
    fn is_milestone_approved(env: Env, project_id: u64, milestone_id: u32) -> bool;
}
