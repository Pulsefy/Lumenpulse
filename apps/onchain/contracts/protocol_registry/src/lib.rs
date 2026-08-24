#![no_std]

mod errors;
mod events;
mod quorum;
mod storage;

use errors::RegistryError;
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Symbol, Vec};
use storage::{DataKey, ModuleEntry};

pub use quorum::{
    ModuleProposal, ProposalStatus, QuorumConfig, RegistryAction, RegistryProposal, Signer,
    MAX_SIGNERS, PROPOSAL_TTL_SECS,
};

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

    // ── Module registration ───────────────────────────────────────────────────

    /// Register a new protocol module. Admin only. Module name must be unique.
    ///
    /// `name`    — canonical module identifier (use `symbol_short!`)
    /// `address` — deployed contract address for this module
    /// `version` — starting version number (must be ≥ 1)
    pub fn register_module(
        env: Env,
        admin: Address,
        name: Symbol,
        address: Address,
        version: u32,
    ) -> Result<(), RegistryError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &admin)?;

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

    /// Update an existing module to a new address and/or version.
    ///
    /// The new `version` must be strictly greater than the current one so
    /// clients can detect upgrades by comparing version numbers.
    pub fn update_module(
        env: Env,
        admin: Address,
        name: Symbol,
        new_address: Address,
        new_version: u32,
    ) -> Result<(), RegistryError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &admin)?;

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
        entry.is_active = true; // updating reactivates a previously deactivated module

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

    /// Mark a module inactive. Inactive modules are rejected by `resolve`.
    /// The entry is retained for historical querying via `get_module`.
    pub fn deactivate_module(env: Env, admin: Address, name: Symbol) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;

        let mut entry: ModuleEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Module(name.clone()))
            .ok_or(RegistryError::ModuleNotFound)?;

        entry.is_active = false;

        env.storage()
            .persistent()
            .set(&DataKey::Module(name.clone()), &entry);

        events::ModuleDeactivatedEvent { name, admin }.publish(&env);

        Ok(())
    }

    /// Re-enable a previously deactivated module.
    pub fn activate_module(env: Env, admin: Address, name: Symbol) -> Result<(), RegistryError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &admin)?;

        let mut entry: ModuleEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Module(name.clone()))
            .ok_or(RegistryError::ModuleNotFound)?;

        entry.is_active = true;

        env.storage()
            .persistent()
            .set(&DataKey::Module(name.clone()), &entry);

        events::ModuleActivatedEvent { name, admin }.publish(&env);

        Ok(())
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Return the full `ModuleEntry` for a module, including inactive ones.
    pub fn get_module(env: Env, name: Symbol) -> Result<ModuleEntry, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Module(name))
            .ok_or(RegistryError::ModuleNotFound)
    }

    /// Resolve the active address for a module.
    ///
    /// Returns `ModuleInactive` if the module exists but has been deactivated,
    /// and `ModuleNotFound` if it was never registered. Clients should prefer
    /// this over `get_module` when they just need an address to call.
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

    /// Returns true only if the module is registered and currently active.
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

    pub fn set_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), RegistryError> {
        Self::require_admin(&env, &current_admin)?;

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        events::AdminTransferredEvent {
            old_admin: current_admin,
            new_admin,
        }
        .publish(&env);

        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    /// Upgrade the contract WASM. Admin only.
    pub fn upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        Self::require_admin(&env, &caller)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    // ══ Multi-admin quorum ═════════════════════════════════════════════════
    //
    // Every privileged action above also has a `*_via_quorum` counterpart that
    // takes an approved proposal id instead of trusting a single admin. The
    // admin-only functions are retained unchanged so existing deployments and
    // tooling keep working; a deployment opts into multi-admin control by
    // installing a quorum policy and using the gated entrypoints.

    // ── Policy management ────────────────────────────────────────────────────

    /// Install the initial quorum policy (signer set + approval threshold).
    ///
    /// The threshold is expressed in the same unit as signer weights, so a
    /// plain "3-of-5" policy is five weight-1 signers with `threshold = 3`.
    /// Rotating an existing policy requires a `SetQuorumConfig` proposal.
    pub fn configure_quorum(
        env: Env,
        signers: Vec<Signer>,
        threshold: u32,
    ) -> Result<(), RegistryError> {
        quorum::configure(&env, signers, threshold)
    }

    /// Replace the signer set / threshold. Requires an approved
    /// `SetQuorumConfig` proposal, so the approver set cannot be taken over by
    /// a single signer, nor by redirecting an admin-rotation approval.
    pub fn set_quorum_config(
        env: Env,
        executor: Address,
        proposal_id: u64,
        signers: Vec<Signer>,
        threshold: u32,
    ) -> Result<(), RegistryError> {
        quorum::consume_approval(
            &env,
            &executor,
            proposal_id,
            &RegistryAction::SetQuorumConfig,
        )?;
        quorum::replace_config(&env, signers, threshold)
    }

    // ── Proposal lifecycle ───────────────────────────────────────────────────

    /// Submit a proposal for a privileged action. The proposer must be a
    /// signer; its weight counts immediately.
    pub fn propose_action(
        env: Env,
        proposer: Address,
        action: RegistryAction,
    ) -> Result<u64, RegistryError> {
        quorum::propose(&env, proposer, action)
    }

    /// Approve an in-flight proposal. Re-signing fails with
    /// `ProposalAlreadySigned`.
    pub fn sign_proposal(
        env: Env,
        signer: Address,
        proposal_id: u64,
    ) -> Result<ProposalStatus, RegistryError> {
        quorum::sign(&env, signer, proposal_id)
    }

    /// Cancel an in-flight proposal. Any signer may cancel.
    pub fn cancel_proposal(
        env: Env,
        signer: Address,
        proposal_id: u64,
    ) -> Result<(), RegistryError> {
        quorum::cancel(&env, signer, proposal_id)
    }

    /// Mark a lapsed proposal `Expired`. Permissionless.
    pub fn expire_proposal(env: Env, proposal_id: u64) -> Result<(), RegistryError> {
        quorum::expire(&env, proposal_id)
    }

    pub fn get_quorum_config(env: Env) -> Result<QuorumConfig, RegistryError> {
        quorum::get_config(&env)
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<RegistryProposal, RegistryError> {
        quorum::get_proposal(&env, proposal_id)
    }

    pub fn get_next_proposal_id(env: Env) -> u64 {
        quorum::next_proposal_id(&env)
    }

    // ── Quorum-gated actions ─────────────────────────────────────────────────

    /// Register a module using an approved `RegisterModule` proposal.
    ///
    /// The proposal binds name/address/version, so the executor cannot swap in
    /// a different address than the one the signers approved.
    pub fn register_module_via_quorum(
        env: Env,
        executor: Address,
        proposal_id: u64,
        name: Symbol,
        address: Address,
        version: u32,
    ) -> Result<(), RegistryError> {
        Self::require_not_paused(&env)?;

        let expected = RegistryAction::RegisterModule(ModuleProposal {
            name: name.clone(),
            address: address.clone(),
            version,
        });
        quorum::consume_approval(&env, &executor, proposal_id, &expected)?;

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

    /// Upgrade a module using an approved `UpdateModule` proposal.
    pub fn update_module_via_quorum(
        env: Env,
        executor: Address,
        proposal_id: u64,
        name: Symbol,
        new_address: Address,
        new_version: u32,
    ) -> Result<(), RegistryError> {
        Self::require_not_paused(&env)?;

        let expected = RegistryAction::UpdateModule(ModuleProposal {
            name: name.clone(),
            address: new_address.clone(),
            version: new_version,
        });
        quorum::consume_approval(&env, &executor, proposal_id, &expected)?;

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

    /// Deactivate a module using an approved `DeactivateModule` proposal.
    pub fn deactivate_module_via_quorum(
        env: Env,
        executor: Address,
        proposal_id: u64,
        name: Symbol,
    ) -> Result<(), RegistryError> {
        let expected = RegistryAction::DeactivateModule(name.clone());
        quorum::consume_approval(&env, &executor, proposal_id, &expected)?;

        let mut entry: ModuleEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Module(name.clone()))
            .ok_or(RegistryError::ModuleNotFound)?;

        entry.is_active = false;

        env.storage()
            .persistent()
            .set(&DataKey::Module(name.clone()), &entry);

        events::ModuleDeactivatedEvent {
            name,
            admin: executor,
        }
        .publish(&env);

        Ok(())
    }

    /// Reactivate a module using an approved `ActivateModule` proposal.
    pub fn activate_module_via_quorum(
        env: Env,
        executor: Address,
        proposal_id: u64,
        name: Symbol,
    ) -> Result<(), RegistryError> {
        Self::require_not_paused(&env)?;

        let expected = RegistryAction::ActivateModule(name.clone());
        quorum::consume_approval(&env, &executor, proposal_id, &expected)?;

        let mut entry: ModuleEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Module(name.clone()))
            .ok_or(RegistryError::ModuleNotFound)?;

        entry.is_active = true;

        env.storage()
            .persistent()
            .set(&DataKey::Module(name.clone()), &entry);

        events::ModuleActivatedEvent {
            name,
            admin: executor,
        }
        .publish(&env);

        Ok(())
    }

    /// Rotate the registry admin using an approved `SetAdmin` proposal.
    pub fn set_admin_via_quorum(
        env: Env,
        executor: Address,
        proposal_id: u64,
        new_admin: Address,
    ) -> Result<(), RegistryError> {
        let expected = RegistryAction::SetAdmin(new_admin.clone());
        quorum::consume_approval(&env, &executor, proposal_id, &expected)?;

        let old_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        events::AdminTransferredEvent {
            old_admin,
            new_admin,
        }
        .publish(&env);

        Ok(())
    }
}

#[cfg(test)]
mod quorum_test;
#[cfg(test)]
mod test;
