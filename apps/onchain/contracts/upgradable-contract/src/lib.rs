#![no_std]

mod errors;
mod events;
mod storage;

use events::{
    AdminChangedEvent, OperationCancelledEvent, OperationExecutedEvent, OperationQueuedEvent,
    UpgradedEvent,
};
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env};
use storage::{QueuedOperation, TimelockAction, LEDGER_BUMP, LEDGER_THRESHOLD, MIN_DELAY_SECONDS};

#[contracttype]
pub enum DataKey {
    Admin,
    Counter,
    NextOperationId,
    QueuedOperation(u32),
}

#[contract]
pub struct UpgradableContract;

#[contractimpl]
impl UpgradableContract {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::NextOperationId, &0u32);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Queue a sensitive admin action with a 24-hour delay.
    pub fn queue_operation(env: Env, proposer: Address, action: TimelockAction) -> u32 {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        if proposer != admin {
            panic!("unauthorized");
        }
        proposer.require_auth();

        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::NextOperationId)
            .unwrap_or(0);

        let now = env.ledger().timestamp();
        let execute_after = now + MIN_DELAY_SECONDS;

        let op = QueuedOperation {
            proposer: proposer.clone(),
            action,
            execute_after,
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

        id
    }

    /// Inspect a queued operation by its ID.
    pub fn get_operation(env: Env, operation_id: u32) -> QueuedOperation {
        env.storage()
            .persistent()
            .get(&DataKey::QueuedOperation(operation_id))
            .expect("operation not found")
    }

    /// Cancel a queued operation before it executes. Admin only.
    pub fn cancel_operation(env: Env, canceller: Address, operation_id: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        if canceller != admin {
            panic!("unauthorized");
        }
        canceller.require_auth();

        if !env
            .storage()
            .persistent()
            .has(&DataKey::QueuedOperation(operation_id))
        {
            panic!("operation not found");
        }

        env.storage()
            .persistent()
            .remove(&DataKey::QueuedOperation(operation_id));

        OperationCancelledEvent {
            canceller,
            operation_id,
        }
        .publish(&env);
    }

    /// Execute a queued operation after the delay has passed.
    pub fn execute_operation(env: Env, executor: Address, operation_id: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        if executor != admin {
            panic!("unauthorized");
        }
        executor.require_auth();

        let op: QueuedOperation = env
            .storage()
            .persistent()
            .get(&DataKey::QueuedOperation(operation_id))
            .expect("operation not found");

        let now = env.ledger().timestamp();
        if now < op.execute_after {
            panic!("timelock not expired");
        }

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
                env.storage().instance().set(&DataKey::Admin, &new_admin);
                AdminChangedEvent {
                    old_admin: executor.clone(),
                    new_admin,
                }
                .publish(&env);
            }
        }

        OperationExecutedEvent {
            executor,
            operation_id,
            executed_at: now,
        }
        .publish(&env);
    }

    /// Direct upgrade (kept for backward compatibility with existing tests).
    pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        if caller != admin {
            panic!("unauthorized");
        }
        caller.require_auth();

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        UpgradedEvent {
            admin: caller,
            new_wasm_hash,
        }
        .publish(&env);
    }

    /// Direct admin transfer (kept for backward compatibility).
    pub fn set_admin(env: Env, current_admin: Address, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        if current_admin != stored_admin {
            panic!("unauthorized");
        }
        current_admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        AdminChangedEvent {
            old_admin: current_admin,
            new_admin,
        }
        .publish(&env);
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
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
