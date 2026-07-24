#![no_std]

mod errors;
mod events;
mod storage;

use errors::RegistryError;
use multisig_guard::{
    cancel as multisig_cancel, configure as multisig_configure, consume_approval,
    expire as multisig_expire, get_config as multisig_get_config, get_proposal,
    propose as multisig_propose, replace_config as multisig_replace_config, sign as multisig_sign,
    MultisigConfig, MultisigDataKey, Proposal, ProposalStatus, Signer, MAX_SIGNERS,
    PROPOSAL_TTL_SECS,
};
use soroban_sdk::{contract, contractimpl, vec, Address, BytesN, Env, IntoVal, Symbol, Vec};
use storage::{DataKey, ModuleEntry, ProposalAction};

pub use storage::ProposalAction as RegistryProposalAction;

#[contract]
pub struct ProtocolRegistryContract;

#[contractimpl]
impl ProtocolRegistryContract {
    // ── Internal guards ───────────────────────────────────────────────────────

    fn require_admin(env: &Env, caller: &Address) -> Result<(), RegistryError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
        if caller != &admin {
            return Err(RegistryError::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), RegistryError> {
        if env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(RegistryError::ContractPaused);
        }
        Ok(())
    }

    // ── Initialization ────────────────────────────────────────────────────────

    /// Deploy and configure the registry. Can only be called once.
    pub fn initialize(env: Env, admin: Address) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);

        events::InitializedEvent { admin }.publish(&env);
        Ok(())
    }

    /// Configure the multisig signer set. Call once after `initialize`.
    pub fn configure_multisig(
        env: Env,
        signers: Vec<Signer>,
        threshold: u32,
    ) -> Result<(), RegistryError> {
        multisig_configure(&env, signers.clone(), threshold).map_err(|_| RegistryError::Unauthorized)?;
        Ok(())
    }

    // ── Multisig proposal lifecycle ──────────────────────────

    pub fn propose(
        env: Env,
        proposer: Address,
        action: ProposalAction,
    ) -> Result<u64, RegistryError> {
        let payload = vec![&env, action.into_val(&env)];
        multisig_propose(&env, proposer, payload).map_err(|_| RegistryError::Unauthorized)
    }

    pub fn sign_proposal(env: Env, signer: Address, proposal_id: u64) -> Result<(), RegistryError> {
        multisig_sign(&env, signer, proposal_id).map_err(|_| RegistryError::Unauthorized)?;
        Ok(())
    }

    pub fn cancel_proposal(
        env: Env,
        signer: Address,
        proposal_id: u64,
    ) -> Result<(), RegistryError> {
        multisig_cancel(&env, signer, proposal_id).map_err(|_| RegistryError::Unauthorized)
    }

    pub fn expire_proposal(env: Env, proposal_id: u64) -> Result<(), RegistryError> {
        multisig_expire(&env, proposal_id).map_err(|_| RegistryError::Unauthorized)
    }

    pub fn get_multisig_config(env: Env) -> Result<MultisigConfig, RegistryError> {
        multisig_get_config(&env).map_err(|_| RegistryError::NotInitialized)
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, RegistryError> {
        get_proposal(&env, proposal_id).map_err(|_| RegistryError::Unauthorized)
    }

    // ── Module registration ───────────────────────────────────────────────────

    pub fn register_module_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        name: Symbol,
        address: Address,
        version: u32,
    ) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::RegisterModule(name.clone(), address.clone(), version).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;

        Self::require_not_paused(&env)?;

        if env
            .storage()
            .persistent()
            .has(&DataKey::Module(name.clone()))
        {
            return Err(RegistryError::ModuleAlreadyRegistered);
        }

        let entry = ModuleEntry {
            name: name.clone(),
            address: address.clone(),
            version,
            registered_at: env.ledger().timestamp(),
            is_active: true,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Module(name.clone()), &entry);

        events::ModuleRegisteredEvent {
            name,
            address,
            version,
        }
        .publish(&env);

        Ok(())
    }

    pub fn update_module_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        name: Symbol,
        new_address: Address,
        new_version: u32,
    ) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::UpdateModule(name.clone(), new_address.clone(), new_version).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;

        Self::require_not_paused(&env)?;

        let mut entry: ModuleEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Module(name.clone()))
            .ok_or(RegistryError::ModuleNotFound)?;

        if new_version <= entry.version {
            return Err(RegistryError::VersionNotIncremented);
        }

        let old_address = entry.address.clone();
        let old_version = entry.version;

        entry.address = new_address.clone();
        entry.version = new_version;
        entry.registered_at = env.ledger().timestamp();
        entry.is_active = true;

        env.storage()
            .persistent()
            .set(&DataKey::Module(name.clone()), &entry);

        events::ModuleUpdatedEvent {
            name,
            old_address,
            new_address,
            old_version,
            new_version,
        }
        .publish(&env);

        Ok(())
    }

    pub fn deactivate_module_via_multisig(env: Env, executor: Address, proposal_id: u64, name: Symbol) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::DeactivateModule(name.clone()).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;

        let mut entry: ModuleEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Module(name.clone()))
            .ok_or(RegistryError::ModuleNotFound)?;

        entry.is_active = false;

        env.storage()
            .persistent()
            .set(&DataKey::Module(name.clone()), &entry);

        events::ModuleDeactivatedEvent { name: name.clone(), admin: executor }.publish(&env);

        Ok(())
    }

    pub fn activate_module_via_multisig(env: Env, executor: Address, proposal_id: u64, name: Symbol) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::ActivateModule(name.clone()).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;

        Self::require_not_paused(&env)?;

        let mut entry: ModuleEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Module(name.clone()))
            .ok_or(RegistryError::ModuleNotFound)?;

        entry.is_active = true;

        env.storage()
            .persistent()
            .set(&DataKey::Module(name.clone()), &entry);

        events::ModuleActivatedEvent { name: name.clone(), admin: executor }.publish(&env);

        Ok(())
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    pub fn get_module(env: Env, name: Symbol) -> Result<ModuleEntry, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Module(name))
            .ok_or(RegistryError::ModuleNotFound)
    }

    pub fn resolve(env: Env, name: Symbol) -> Result<Address, RegistryError> {
        let entry: ModuleEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Module(name))
            .ok_or(RegistryError::ModuleNotFound)?;

        if !entry.is_active {
            return Err(RegistryError::ModuleInactive);
        }

        Ok(entry.address)
    }

    pub fn is_active(env: Env, name: Symbol) -> bool {
        env.storage()
            .persistent()
            .get::<_, ModuleEntry>(&DataKey::Module(name))
            .map(|e| e.is_active)
            .unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Result<Address, RegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)
    }

    // ── Admin controls ────────────────────────────────────────────────────────

    pub fn set_admin_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        new_admin: Address,
    ) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::SetAdmin(new_admin.clone()).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;

        let current_admin = Self::get_admin(env.clone())?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);

        events::AdminTransferredEvent {
            old_admin: current_admin,
            new_admin,
        }
        .publish(&env);

        Ok(())
    }

    pub fn pause_via_multisig(env: Env, executor: Address, proposal_id: u64) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::Pause.into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    pub fn unpause_via_multisig(env: Env, executor: Address, proposal_id: u64) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::Unpause.into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    pub fn upgrade_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::Upgrade(new_wasm_hash.clone()).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}

#[cfg(test)]
mod test;
