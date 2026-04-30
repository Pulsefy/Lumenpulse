use soroban_sdk::{Address, BytesN, Env, Symbol};

/// Event emitted when the timelock contract is initialized
pub struct TimelockInitializedEvent {
    pub admin: Address,
}

impl TimelockInitializedEvent {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            ("timelock", "initialized"),
            (self.admin.clone(),),
        );
    }
}

/// Event emitted when an action is queued
pub struct ActionQueuedEvent {
    pub proposal_id: BytesN<32>,
    pub proposer: Address,
    pub action_type: Symbol,
    pub target_contract: Address,
    pub queued_at: u64,
    pub execute_at: u64,
}

impl ActionQueuedEvent {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            ("timelock", "action_queued"),
            (
                self.proposal_id.clone(),
                self.proposer.clone(),
                self.action_type.clone(),
                self.target_contract.clone(),
                self.queued_at,
                self.execute_at,
            ),
        );
    }
}

/// Event emitted when an action is executed
pub struct ActionExecutedEvent {
    pub proposal_id: BytesN<32>,
    pub executed_at: u64,
    pub action_type: Symbol,
    pub target_contract: Address,
}

impl ActionExecutedEvent {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            ("timelock", "action_executed"),
            (
                self.proposal_id.clone(),
                self.executed_at,
                self.action_type.clone(),
                self.target_contract.clone(),
            ),
        );
    }
}

/// Event emitted when an action is cancelled
pub struct ActionCancelledEvent {
    pub proposal_id: BytesN<32>,
    pub cancelled_by: Address,
    pub cancelled_at: u64,
}

impl ActionCancelledEvent {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            ("timelock", "action_cancelled"),
            (
                self.proposal_id.clone(),
                self.cancelled_by.clone(),
                self.cancelled_at,
            ),
        );
    }
}

/// Event emitted when configuration is updated
pub struct ConfigUpdatedEvent {
    pub admin: Address,
    pub min_delay: u64,
    pub max_delay: u64,
}

impl ConfigUpdatedEvent {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            ("timelock", "config_updated"),
            (self.admin.clone(), self.min_delay, self.max_delay),
        );
    }
}

/// Event emitted when admin changes
pub struct AdminChangedEvent {
    pub old_admin: Address,
    pub new_admin: Address,
}

impl AdminChangedEvent {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            ("timelock", "admin_changed"),
            (self.old_admin.clone(), self.new_admin.clone()),
        );
    }
}
