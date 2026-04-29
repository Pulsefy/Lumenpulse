#![no_std]

mod errors;
mod events;
mod storage;

use errors::TimelockError;
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, Symbol, Vec};
use storage::{DataKey, TimelockConfig, TimelockProposal};

#[contract]
pub struct TimelockContract;

#[contractimpl]
impl TimelockContract {
    // ── Helpers ──────────────────────────────────────────────────────────────

    fn require_admin(env: &Env, caller: &Address) -> Result<(), TimelockError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TimelockError::NotInitialized)?;
        if caller != &admin {
            return Err(TimelockError::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }

    fn require_proposer(env: &Env, proposal: &TimelockProposal, caller: &Address) -> Result<(), TimelockError> {
        if &proposal.proposer != caller {
            return Err(TimelockError::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }

    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialize the timelock contract.
    ///
    /// `admin` - The admin address with proposal privileges
    /// `min_delay` - Minimum delay (in seconds) before a proposal can be executed
    /// `max_delay` - Maximum delay (in seconds) for proposal validity
    pub fn initialize(
        env: Env,
        admin: Address,
        min_delay: u64,
        max_delay: u64,
    ) -> Result<(), TimelockError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(TimelockError::AlreadyInitialized);
        }
        if min_delay == 0 {
            return Err(TimelockError::InvalidDelay);
        }
        if max_delay <= min_delay {
            return Err(TimelockError::InvalidDelay);
        }
        admin.require_auth();

        let config = TimelockConfig {
            min_delay,
            max_delay,
        };

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Config, &config);

        events::TimelockInitializedEvent { admin }.publish(&env);
        Ok(())
    }

    // ── Proposal Queue ────────────────────────────────────────────────────────

    /// Queue a timelocked action for future execution.
    ///
    /// `action_type` - The type of action to execute (e.g., "update_config", "pause", "set_admin", "upgrade")
    /// `target_contract` - The contract address where the action will be executed
    /// `payload` - Encoded parameters for the action
    /// `delay` - The delay in seconds before this action can be executed (must be >= min_delay)
    pub fn queue_action(
        env: Env,
        proposer: Address,
        action_type: Symbol,
        target_contract: Address,
        payload: Bytes,
        delay: u64,
    ) -> Result<BytesN<32>, TimelockError> {
        Self::require_admin(&env, &proposer)?;

        let config: TimelockConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(TimelockError::NotInitialized)?;

        if delay < config.min_delay {
            return Err(TimelockError::DelayTooShort);
        }
        if delay > config.max_delay {
            return Err(TimelockError::DelayTooLong);
        }

        // Generate a unique proposal ID using nonce and timestamp
        let nonce: u64 = env.storage().instance().get(&DataKey::Nonce).unwrap_or(0);
        let timestamp = env.ledger().timestamp();
        
        // Create bytes from nonce and timestamp
        let mut input = Bytes::new(&env);
        input.push_back((nonce >> 56) as u8);
        input.push_back((nonce >> 48) as u8);
        input.push_back((nonce >> 40) as u8);
        input.push_back((nonce >> 32) as u8);
        input.push_back((nonce >> 24) as u8);
        input.push_back((nonce >> 16) as u8);
        input.push_back((nonce >> 8) as u8);
        input.push_back(nonce as u8);
        input.push_back((timestamp >> 56) as u8);
        input.push_back((timestamp >> 48) as u8);
        input.push_back((timestamp >> 40) as u8);
        input.push_back((timestamp >> 32) as u8);
        input.push_back((timestamp >> 24) as u8);
        input.push_back((timestamp >> 16) as u8);
        input.push_back((timestamp >> 8) as u8);
        input.push_back(timestamp as u8);
        
        let proposal_id: BytesN<32> = env.crypto().sha256(&input).into();
        
        // Increment nonce
        env.storage().instance().set(&DataKey::Nonce, &(nonce + 1));

        // Check if proposal already exists
        if env.storage().persistent().has(&DataKey::Proposal(proposal_id.clone().into())) {
            return Err(TimelockError::ProposalAlreadyExists);
        }

        let execute_at = env.ledger().timestamp() + delay;
        let expires_at = execute_at + config.max_delay;

        let proposal = TimelockProposal {
            id: proposal_id.clone().into(),
            proposer: proposer.clone(),
            action_type,
            target_contract,
            payload,
            delay,
            queued_at: env.ledger().timestamp(),
            execute_at,
            expires_at,
            executed: false,
            cancelled: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id.clone().into()), &proposal);

        events::ActionQueuedEvent {
            proposal_id: proposal_id.clone().into(),
            proposer,
            action_type: proposal.action_type,
            target_contract: proposal.target_contract,
            queued_at: proposal.queued_at,
            execute_at: proposal.execute_at,
        }
        .publish(&env);

        Ok(proposal_id)
    }

    // ── Execution ─────────────────────────────────────────────────────────────

    /// Execute a queued proposal after the delay has elapsed.
    pub fn execute_proposal(
        env: Env,
        proposal_id: BytesN<32>,
    ) -> Result<(), TimelockError> {
        let mut proposal: TimelockProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id.clone()))
            .ok_or(TimelockError::ProposalNotFound)?;

        // Check if already executed or cancelled
        if proposal.executed {
            return Err(TimelockError::AlreadyExecuted);
        }
        if proposal.cancelled {
            return Err(TimelockError::ProposalCancelled);
        }

        // Check if delay has elapsed
        let current_time = env.ledger().timestamp();
        if current_time < proposal.execute_at {
            return Err(TimelockError::DelayNotElapsed);
        }

        // Check if proposal has expired
        if current_time > proposal.expires_at {
            return Err(TimelockError::ProposalExpired);
        }

        // Mark as executed
        proposal.executed = true;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id.clone()), &proposal);

        // Execute the action on the target contract
        // Note: For cross-contract calls with custom payloads, 
        // the target contract must implement a standard interface
        env.events().publish(
            ("timelock", "executing"),
            (
                proposal_id.clone(),
                proposal.action_type.clone(),
                proposal.target_contract.clone(),
            ),
        );

        events::ActionExecutedEvent {
            proposal_id: proposal_id.clone(),
            executed_at: current_time,
            action_type: proposal.action_type,
            target_contract: proposal.target_contract,
        }
        .publish(&env);

        Ok(())
    }

    // ── Cancellation ──────────────────────────────────────────────────────────

    /// Cancel a queued proposal before execution.
    ///
    /// Can only be called by the original proposer or admin.
    pub fn cancel_proposal(
        env: Env,
        caller: Address,
        proposal_id: BytesN<32>,
    ) -> Result<(), TimelockError> {
        let mut proposal: TimelockProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id.clone()))
            .ok_or(TimelockError::ProposalNotFound)?;

        // Only proposer or admin can cancel
        if proposal.proposer != caller {
            let admin: Address = env
                .storage()
                .instance()
                .get(&DataKey::Admin)
                .ok_or(TimelockError::NotInitialized)?;
            if caller != admin {
                return Err(TimelockError::Unauthorized);
            }
        }
        caller.require_auth();

        // Check if already executed
        if proposal.executed {
            return Err(TimelockError::AlreadyExecuted);
        }
        if proposal.cancelled {
            return Err(TimelockError::ProposalCancelled);
        }

        // Mark as cancelled
        proposal.cancelled = true;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id.clone()), &proposal);

        events::ActionCancelledEvent {
            proposal_id,
            cancelled_by: caller,
            cancelled_at: env.ledger().timestamp(),
        }
        .publish(&env);

        Ok(())
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Get proposal details by ID
    pub fn get_proposal(env: Env, proposal_id: BytesN<32>) -> Result<TimelockProposal, TimelockError> {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(TimelockError::ProposalNotFound)
    }

    /// Check if a proposal exists
    pub fn has_proposal(env: Env, proposal_id: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::Proposal(proposal_id))
    }

    /// Get timelock configuration
    pub fn get_config(env: Env) -> Result<TimelockConfig, TimelockError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(TimelockError::NotInitialized)
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Result<Address, TimelockError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TimelockError::NotInitialized)
    }

    /// Check if a proposal is ready for execution
    pub fn is_executable(env: Env, proposal_id: BytesN<32>) -> Result<bool, TimelockError> {
        let proposal: TimelockProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(TimelockError::ProposalNotFound)?;

        if proposal.executed || proposal.cancelled {
            return Ok(false);
        }

        let current_time = env.ledger().timestamp();
        Ok(current_time >= proposal.execute_at && current_time <= proposal.expires_at)
    }

    // ── Admin controls ────────────────────────────────────────────────────────

    /// Update timelock configuration (min_delay and max_delay)
    pub fn update_config(
        env: Env,
        admin: Address,
        min_delay: u64,
        max_delay: u64,
    ) -> Result<(), TimelockError> {
        Self::require_admin(&env, &admin)?;
        if min_delay == 0 {
            return Err(TimelockError::InvalidDelay);
        }
        if max_delay <= min_delay {
            return Err(TimelockError::InvalidDelay);
        }

        let config = TimelockConfig {
            min_delay,
            max_delay,
        };

        env.storage().instance().set(&DataKey::Config, &config);

        events::ConfigUpdatedEvent {
            admin,
            min_delay,
            max_delay,
        }
        .publish(&env);

        Ok(())
    }

    /// Transfer admin role to a new address
    pub fn set_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), TimelockError> {
        Self::require_admin(&env, &current_admin)?;

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        events::AdminChangedEvent {
            old_admin: current_admin,
            new_admin,
        }
        .publish(&env);

        Ok(())
    }
}

#[cfg(test)]
mod test;
