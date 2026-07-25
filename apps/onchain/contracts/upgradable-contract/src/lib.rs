#![no_std]

mod errors;
mod events;
mod storage;

use events::{
    AdminChangedEvent, OperationCancelledEvent, OperationExecutedEvent, OperationQueuedEvent,
    UpgradedEvent,
};
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env};
use storage::{
    QueuedOperation, TimelockAction, GRACE_PERIOD_SECONDS, LEDGER_BUMP, LEDGER_THRESHOLD,
    MIN_DELAY_SECONDS,
};

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

    /// Queue a sensitive admin action with a 24-hour delay and 7-day grace period.
    /// Returns the operation ID. Emits OperationQueuedEvent.
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
        let expires_at = execute_after + GRACE_PERIOD_SECONDS;

        let op = QueuedOperation {
            proposer: proposer.clone(),
            action,
            execute_after,
            created_at: now,
            expires_at,
        };

        env.storage()
            .persistent()
            .set(&DataKey::QueuedOperation(id), &op);
        // Extend TTL for the newly created persistent entry
        env.storage().persistent().extend_ttl(
            &DataKey::QueuedOperation(id),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

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
            expires_at,
        }
        .publish(&env);

        id
    }

    /// Inspect a queued operation by its ID. Queryable on-chain.
    /// Panics with "operation not found" if ID does not exist.
    pub fn get_operation(env: Env, operation_id: u32) -> QueuedOperation {
        let key = DataKey::QueuedOperation(operation_id);
        let op: QueuedOperation = env
            .storage()
            .persistent()
            .get(&key)
            .expect("operation not found");
        // Extend TTL on read to keep queryable metadata alive
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        op
    }

    /// Returns the next operation ID that will be assigned. Useful for off-chain indexers.
    pub fn get_next_operation_id(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::NextOperationId)
            .unwrap_or(0)
    }

    /// Returns true if the operation is within its execution window [execute_after, expires_at].
    pub fn is_operation_ready(env: Env, operation_id: u32) -> bool {
        let key = DataKey::QueuedOperation(operation_id);
        let op: QueuedOperation = env
            .storage()
            .persistent()
            .get(&key)
            .expect("operation not found");
        let now = env.ledger().timestamp();
        now >= op.execute_after && now <= op.expires_at
    }

    /// Cancel a queued operation before it executes. Admin only.
    /// Panics if operation does not exist or caller is not admin.
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

        let key = DataKey::QueuedOperation(operation_id);
        if !env.storage().persistent().has(&key) {
            panic!("operation not found");
        }

        env.storage().persistent().remove(&key);

        OperationCancelledEvent {
            canceller,
            operation_id,
        }
        .publish(&env);

        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Execute a queued operation after the delay has passed but before expiry.
    /// Enforces timelock: panics "timelock not expired" if too early, "operation expired" if past grace.
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

        let key = DataKey::QueuedOperation(operation_id);
        let op: QueuedOperation = env
            .storage()
            .persistent()
            .get(&key)
            .expect("operation not found");

        let now = env.ledger().timestamp();
        if now < op.execute_after {
            panic!("timelock not expired");
        }
        if now > op.expires_at {
            // Operation is past grace period and is considered expired.
            // It remains stored until explicitly cancelled to allow auditability,
            // but execution is rejected.
            panic!("operation expired");
        }

        // Remove before executing to prevent re-entrancy replay
        env.storage().persistent().remove(&key);

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

        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Direct upgrade bypass is disabled to enforce timelock review window.
    /// Must use queue_operation + execute_operation.
    pub fn upgrade(env: Env, caller: Address, _new_wasm_hash: BytesN<32>) {
        let _admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        // Auth check first to ensure caller is at least trying to authenticate,
        // then reject bypass regardless.
        caller.require_auth();
        panic!("direct upgrade disabled: use timelock flow");
    }

    /// Direct admin transfer bypass is disabled to enforce timelock review window.
    pub fn set_admin(env: Env, current_admin: Address, _new_admin: Address) {
        let _stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        current_admin.require_auth();
        panic!("direct admin transfer disabled: use timelock flow");
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
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        count
    }

    pub fn get_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Counter).unwrap_or(0)
    }

    pub fn version() -> u32 {
        2
    }
}

mod test;
