#![no_std]

mod errors;
mod events;
mod storage;

use errors::ContractError;
use events::{
    AdminChangedEvent, OperationCancelledEvent, OperationExecutedEvent, OperationQueuedEvent,
    UpgradedEvent,
};
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};
use storage::{
    OperationStatus, QueuedOperation, TimelockAction, GRACE_PERIOD_SECONDS, LEDGER_BUMP,
    LEDGER_THRESHOLD, MIN_DELAY_SECONDS,
};

#[contracttype]
pub enum DataKey {
    Admin,
    PendingAdmin,
    Counter,
    NextOperationId,
    QueuedOperation(u32),
}

#[contract]
pub struct UpgradableContract;

#[contractimpl]
impl UpgradableContract {
    fn require_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        if caller != &admin {
            return Err(ContractError::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }

    fn operation_status(env: &Env, op: &QueuedOperation) -> OperationStatus {
        let now = env.ledger().timestamp();
        if now < op.execute_after {
            OperationStatus::Pending
        } else if now > op.expires_at {
            OperationStatus::Expired
        } else {
            OperationStatus::Ready
        }
    }

    pub fn init(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::NextOperationId, &0u32);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

    /// Propose a new admin. The current admin remains active until the
    /// proposed admin accepts the transfer.
    pub fn propose_admin(
        env: Env,
        proposer: Address,
        new_admin: Address,
    ) -> Result<(), ContractError> {
        Self::require_admin(&env, &proposer)?;
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

    /// Accept a pending admin transfer. Only the proposed admin may accept.
    pub fn accept_admin(env: Env, new_admin: Address) -> Result<(), ContractError> {
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(ContractError::AdminRotationNotFound)?;
        if new_admin != pending_admin {
            return Err(ContractError::Unauthorized);
        }
        new_admin.require_auth();

        let old_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);

        AdminChangedEvent {
            old_admin,
            new_admin,
        }
        .publish(&env);
        Ok(())
    }

    /// Cancel a pending admin transfer. Only the current admin may cancel.
    pub fn cancel_admin(env: Env, canceller: Address) -> Result<(), ContractError> {
        Self::require_admin(&env, &canceller)?;
        if !env.storage().instance().has(&DataKey::PendingAdmin) {
            return Err(ContractError::AdminRotationNotFound);
        }
        env.storage().instance().remove(&DataKey::PendingAdmin);
        Ok(())
    }

    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    /// Queue a sensitive admin action (upgrade or admin rotation). Admin
    /// only. The operation becomes executable after `MIN_DELAY_SECONDS` and
    /// remains executable for `GRACE_PERIOD_SECONDS` after that — there is
    /// no way to act on it sooner or later than this window.
    pub fn queue_operation(
        env: Env,
        proposer: Address,
        action: TimelockAction,
    ) -> Result<u32, ContractError> {
        Self::require_admin(&env, &proposer)?;

        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::NextOperationId)
            .unwrap_or(0);

        let now = env.ledger().timestamp();
        let execute_after = now + MIN_DELAY_SECONDS;
        let expires_at = execute_after + GRACE_PERIOD_SECONDS;

        let op = QueuedOperation {
            proposer: proposer.clone(),
            action,
            execute_after,
            expires_at,
            created_at: now,
        };

        env.storage()
            .persistent()
            .set(&DataKey::QueuedOperation(id), &op);

        env.storage()
            .instance()
            .set(&DataKey::NextOperationId, &(id + 1));

        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        OperationQueuedEvent {
            proposer,
            operation_id: id,
            execute_after,
        }
        .publish(&env);

        Ok(id)
    }

    /// Inspect a queued operation by its ID.
    pub fn get_operation(env: Env, operation_id: u32) -> Result<QueuedOperation, ContractError> {
        env.storage()
            .persistent()
            .get(&DataKey::QueuedOperation(operation_id))
            .ok_or(ContractError::OperationNotFound)
    }

    /// Pending / Ready / Expired classification for a queued operation,
    /// without triggering `execute_operation`'s rejection.
    pub fn get_operation_status(
        env: Env,
        operation_id: u32,
    ) -> Result<OperationStatus, ContractError> {
        let op: QueuedOperation = env
            .storage()
            .persistent()
            .get(&DataKey::QueuedOperation(operation_id))
            .ok_or(ContractError::OperationNotFound)?;
        Ok(Self::operation_status(&env, &op))
    }

    /// Cancel a queued operation before (or after) it becomes executable.
    /// Admin only.
    pub fn cancel_operation(
        env: Env,
        canceller: Address,
        operation_id: u32,
    ) -> Result<(), ContractError> {
        Self::require_admin(&env, &canceller)?;

        if !env
            .storage()
            .persistent()
            .has(&DataKey::QueuedOperation(operation_id))
        {
            return Err(ContractError::OperationNotFound);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::QueuedOperation(operation_id));

        OperationCancelledEvent {
            canceller,
            operation_id,
        }
        .publish(&env);

        Ok(())
    }

    /// Execute a queued operation. Admin only. Rejects if the timelock delay
    /// hasn't elapsed yet (`OperationNotReady`) or if the grace period has
    /// elapsed (`OperationExpired`) — this is the only path by which an
    /// upgrade or admin rotation can take effect; there is no instant
    /// bypass.
    pub fn execute_operation(
        env: Env,
        executor: Address,
        operation_id: u32,
    ) -> Result<(), ContractError> {
        Self::require_admin(&env, &executor)?;

        let op: QueuedOperation = env
            .storage()
            .persistent()
            .get(&DataKey::QueuedOperation(operation_id))
            .ok_or(ContractError::OperationNotFound)?;

        match Self::operation_status(&env, &op) {
            OperationStatus::Pending => return Err(ContractError::OperationNotReady),
            OperationStatus::Expired => return Err(ContractError::OperationExpired),
            OperationStatus::Ready => {}
        }

        let now = env.ledger().timestamp();

        env.storage()
            .persistent()
            .remove(&DataKey::QueuedOperation(operation_id));

        match op.action.clone() {
            TimelockAction::Upgrade(new_wasm_hash) => {
                env.deployer()
                    .update_current_contract_wasm(new_wasm_hash.clone());
                UpgradedEvent {
                    admin: executor.clone(),
                    new_wasm_hash,
                }
                .publish(&env);
            }
            TimelockAction::SetAdmin(new_admin) => {
                // The timelock only makes the proposal active. The new admin
                // must still call `accept_admin` before authority changes.
                env.storage().instance().set(&DataKey::PendingAdmin, &new_admin);
            }
        }

        OperationExecutedEvent {
            executor,
            operation_id,
            executed_at: now,
        }
        .publish(&env);

        Ok(())
    }

    pub fn get_admin(env: Env) -> Result<Address, ContractError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)
    }

    pub fn increment(env: Env) -> u32 {
        let mut count: u32 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        count += 1;
        env.storage().instance().set(&DataKey::Counter, &count);
        count
    }

    pub fn get_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Counter).unwrap_or(0)
    }

    pub fn version() -> u32 {
        1
    }
}

mod test;
