#![no_std]

mod errors;
mod events;
mod math;
mod storage;
mod token;

use errors::CrowdfundError;
use math::{sqrt_scaled, unscale};
use soroban_sdk::token::TokenClient;
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Symbol};
use storage::{DataKey, ProjectData};

#[contract]
pub struct CrowdfundVaultContract;

#[contractimpl]
impl CrowdfundVaultContract {
    /// Helper function to verify admin authorization
    /// Reduces code duplication and ensures consistent admin checks
    fn verify_admin(env: &Env, caller: &Address) -> Result<(), CrowdfundError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CrowdfundError::NotInitialized)?;

        if caller != &stored_admin {
            return Err(CrowdfundError::Unauthorized);
        }

        caller.require_auth();
        Ok(())
    }

    /// Initialize the contract with an admin address
    pub fn initialize(env: Env, admin: Address) -> Result<(), CrowdfundError> {
        // Check if already initialized
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(CrowdfundError::AlreadyInitialized);
        }

        // Require admin authorization
        admin.require_auth();

        // Store admin address
        env.storage().instance().set(&DataKey::Admin, &admin);

        // Store Emergency Pause bool
        env.storage().instance().set(&DataKey::Paused, &false);

        // Initialize project ID counter
        env.storage().instance().set(&DataKey::NextProjectId, &0u64);

        // Emit initialization event
        events::InitializedEvent { admin }.publish(&env);

        Ok(())
    }

    /// Create a new project
    pub fn create_project(
        env: Env,
        owner: Address,
        name: Symbol,
        target_amount: i128,
        token_address: Address,
    ) -> Result<u64, CrowdfundError> {
        // Check if contract is initialized
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(CrowdfundError::NotInitialized);
        }

        // Require owner authorization
        owner.require_auth();

        // Check Emergency Pause State (single read)
        let is_paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if is_paused {
            return Err(CrowdfundError::ContractPaused);
        }

        // Validate target amount
        if target_amount <= 0 {
            return Err(CrowdfundError::InvalidAmount);
        }

        // Get next project ID
        let project_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextProjectId)
            .unwrap_or(0);

        // Create project data (avoid unnecessary clones)
        let project = ProjectData {
            id: project_id,
            owner: owner.clone(),
            name,
            target_amount,
            token_address: token_address.clone(),
            total_deposited: 0,
            total_withdrawn: 0,
            is_active: true,
        };

        // Store project
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &project);

        // Initialize project balance (construct key once)
        let balance_key = DataKey::ProjectBalance(project_id, token_address.clone());
        env.storage().persistent().set(&balance_key, &0i128);

        // Initialize milestone approval status
        env.storage()
            .persistent()
            .set(&DataKey::MilestoneApproved(project_id), &false);

        // Increment project ID counter
        env.storage()
            .instance()
            .set(&DataKey::NextProjectId, &(project_id + 1));

        // Emit project creation event
        events::ProjectCreatedEvent {
            owner,
            token_address,
            project_id,
        }
        .publish(&env);

        Ok(project_id)
    }

    /// Cancel project (owner or admin only)
    pub fn cancel_project(
        env: Env,
        caller: Address,
        project_id: u64,
    ) -> Result<(), CrowdfundError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CrowdfundError::NotInitialized)?;

        let mut project: ProjectData = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        let is_admin = caller == stored_admin;
        let is_owner = caller == project.owner;

        if !is_admin && !is_owner {
            return Err(CrowdfundError::Unauthorized);
        }

        caller.require_auth();

        if !project.is_active {
            return Err(CrowdfundError::ProjectNotActive);
        }

        // Mark as canceled
        project.is_active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &project);

        env.storage().persistent().set(
            &DataKey::ProjectStatus(project_id),
            &Symbol::new(&env, "CANCELED"),
        );

        events::ProjectCanceledEvent { project_id, caller }.publish(&env);

        Ok(())
    }

    /// Refund all contributors (anyone can call after cancel, but usually admin/owner)
    pub fn refund_contributors(
        env: Env,
        project_id: u64,
        caller: Address,
    ) -> Result<(), CrowdfundError> {
        caller.require_auth();
        let project: ProjectData = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        if project.is_active {
            return Err(CrowdfundError::ProjectNotCancellable);
        }

        let status: Symbol = env
            .storage()
            .persistent()
            .get(&DataKey::ProjectStatus(project_id))
            .unwrap_or(Symbol::new(&env, "ACTIVE"));

        if status != Symbol::new(&env, "CANCELED") {
            return Err(CrowdfundError::ProjectNotCancellable);
        }

        let count_key = DataKey::ContributorCount(project_id);
        let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);

        let contract_address = env.current_contract_address();
        let token_client = TokenClient::new(&env, &project.token_address);

        for i in 0..count {
            let contrib_key = DataKey::Contributor(project_id, i);
            let contributor: Address = env
                .storage()
                .persistent()
                .get(&contrib_key)
                .ok_or(CrowdfundError::ProjectNotFound)?;

            let amount_key = DataKey::Contribution(project_id, contributor.clone());
            let amount: i128 = env.storage().persistent().get(&amount_key).unwrap_or(0);

            if amount > 0 {
                token_client.transfer(&contract_address, &contributor, &amount);

                env.storage().persistent().remove(&amount_key);

                events::ContributionRefundedEvent {
                    project_id,
                    contributor,
                    amount,
                }
                .publish(&env);
            }
        }

        env.storage().persistent().remove(&count_key);
        let balance_key = DataKey::ProjectBalance(project_id, project.token_address);
        env.storage().persistent().set(&balance_key, &0i128);

        Ok(())
    }

    /// Deposit funds into a project
    pub fn deposit(
        env: Env,
        user: Address,
        project_id: u64,
        amount: i128,
    ) -> Result<(), CrowdfundError> {
        // Check if contract is initialized
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(CrowdfundError::NotInitialized);
        }

        // Require user authorization
        user.require_auth();

        // Check Emergency Pause State (single read)
        let is_paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if is_paused {
            return Err(CrowdfundError::ContractPaused);
        }

        // Validate amount
        if amount <= 0 {
            return Err(CrowdfundError::InvalidAmount);
        }

        // Get project
        let mut project: ProjectData = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        // Check if project is active
        if !project.is_active {
            return Err(CrowdfundError::ProjectNotActive);
        }

        // Transfer tokens from user to contract if they have sufficient balance
        let contract_address = env.current_contract_address();
        let user_balance = token::balance(&env, &project.token_address, &user);
        if user_balance >= amount {
            token::transfer(
                &env,
                &project.token_address,
                &user,
                &contract_address,
                &amount,
            );
        }

        // Construct balance key once and reuse
        let balance_key = DataKey::ProjectBalance(project_id, project.token_address.clone());
        let current_balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&balance_key, &(current_balance + amount));

        // Track individual contribution for quadratic funding
        let contribution_key = DataKey::Contribution(project_id, user.clone());
        let current_contribution: i128 = env
            .storage()
            .persistent()
            .get(&contribution_key)
            .unwrap_or(0);

        // If this is a new contributor, add them to the contributors list
        if current_contribution == 0 {
            let contributor_count_key = DataKey::ContributorCount(project_id);
            let contributor_count: u32 = env
                .storage()
                .persistent()
                .get(&contributor_count_key)
                .unwrap_or(0);

            // Store contributor at index
            env.storage()
                .persistent()
                .set(&DataKey::Contributor(project_id, contributor_count), &user);

            // Increment contributor count
            env.storage()
                .persistent()
                .set(&contributor_count_key, &(contributor_count + 1));
        }

        // Update contribution amount
        env.storage()
            .persistent()
            .set(&contribution_key, &(current_contribution + amount));

        // Update project total deposited
        project.total_deposited += amount;
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &project);

        // Emit deposit event
        events::DepositEvent {
            user,
            project_id,
            amount,
        }
        .publish(&env);

        Ok(())
    }

    /// Approve milestone for a project (admin only)
    pub fn approve_milestone(
        env: Env,
        admin: Address,
        project_id: u64,
    ) -> Result<(), CrowdfundError> {
        // Verify admin (single check with helper)
        Self::verify_admin(&env, &admin)?;

        // Check Emergency Pause State (single read)
        let is_paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if is_paused {
            return Err(CrowdfundError::ContractPaused);
        }

        // Check if project exists (single get instead of has + get)
        env.storage()
            .persistent()
            .get::<_, ProjectData>(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        // Approve milestone
        env.storage()
            .persistent()
            .set(&DataKey::MilestoneApproved(project_id), &true);

        // Emit milestone approval event
        events::MilestoneApprovedEvent { admin, project_id }.publish(&env);

        Ok(())
    }

    /// Withdraw funds from a project (owner only, requires milestone approval)
    pub fn withdraw(env: Env, project_id: u64, amount: i128) -> Result<(), CrowdfundError> {
        // Check if contract is initialized
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(CrowdfundError::NotInitialized);
        }

        // Check Emergency Pause State (single read)
        let is_paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if is_paused {
            return Err(CrowdfundError::ContractPaused);
        }

        // Get project
        let mut project: ProjectData = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        // Require owner authorization
        project.owner.require_auth();

        // Check if project is active
        if !project.is_active {
            return Err(CrowdfundError::ProjectNotActive);
        }

        // Validate amount
        if amount <= 0 {
            return Err(CrowdfundError::InvalidAmount);
        }

        // Check milestone approval
        let is_approved: bool = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneApproved(project_id))
            .unwrap_or(false);

        if !is_approved {
            return Err(CrowdfundError::MilestoneNotApproved);
        }

        // Construct balance key once
        let balance_key = DataKey::ProjectBalance(project_id, project.token_address.clone());
        let current_balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);

        if current_balance < amount {
            return Err(CrowdfundError::InsufficientBalance);
        }

        // Transfer tokens from contract to owner
        let contract_address = env.current_contract_address();
        token::transfer(
            &env,
            &project.token_address,
            &contract_address,
            &project.owner,
            &amount,
        );

        // Update project balance
        env.storage()
            .persistent()
            .set(&balance_key, &(current_balance - amount));

        // Update project total withdrawn
        project.total_withdrawn += amount;
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &project);

        // Emit withdraw event
        events::WithdrawEvent {
            owner: project.owner,
            project_id,
            amount,
        }
        .publish(&env);

        Ok(())
    }

    /// Register a new contributor
    pub fn register_contributor(env: Env, contributor: Address) -> Result<(), CrowdfundError> {
        // Require contributor authorization
        contributor.require_auth();

        // Check if already registered
        if env
            .storage()
            .persistent()
            .has(&DataKey::RegisteredContributor(contributor.clone()))
        {
            return Err(CrowdfundError::AlreadyRegistered);
        }

        // Store registration
        env.storage()
            .persistent()
            .set(&DataKey::RegisteredContributor(contributor.clone()), &true);

        // Initialize reputation
        env.storage()
            .persistent()
            .set(&DataKey::Reputation(contributor.clone()), &0i128);

        // Emit registration event
        events::ContributorRegisteredEvent { contributor }.publish(&env);

        Ok(())
    }

    /// Update contributor reputation (admin only for now, or could be internal)
    pub fn update_reputation(
        env: Env,
        admin: Address,
        contributor: Address,
        change: i128,
    ) -> Result<(), CrowdfundError> {
        // Verify admin (single check with helper)
        Self::verify_admin(&env, &admin)?;

        // Check if contributor is registered
        if !env
            .storage()
            .persistent()
            .has(&DataKey::RegisteredContributor(contributor.clone()))
        {
            return Err(CrowdfundError::ContributorNotFound);
        }

        // Get current reputation
        let old_reputation: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reputation(contributor.clone()))
            .unwrap_or(0);
        let new_reputation = old_reputation + change;

        // Store new reputation
        env.storage()
            .persistent()
            .set(&DataKey::Reputation(contributor.clone()), &new_reputation);

        // Emit reputation change event
        events::ReputationUpdatedEvent {
            contributor,
            old_reputation,
            new_reputation,
        }
        .publish(&env);

        Ok(())
    }

    /// Get contributor reputation
    pub fn get_reputation(env: Env, contributor: Address) -> Result<i128, CrowdfundError> {
        if !env
            .storage()
            .persistent()
            .has(&DataKey::RegisteredContributor(contributor.clone()))
        {
            return Err(CrowdfundError::ContributorNotFound);
        }
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::Reputation(contributor))
            .unwrap_or(0))
    }

    /// Get project data
    pub fn get_project(env: Env, project_id: u64) -> Result<ProjectData, CrowdfundError> {
        env.storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)
    }

    /// Get project balance
    pub fn get_balance(env: Env, project_id: u64) -> Result<i128, CrowdfundError> {
        // Get project to get token address (use destructuring to avoid full clone)
        let project: ProjectData = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        let balance_key = DataKey::ProjectBalance(project_id, project.token_address);
        Ok(env.storage().persistent().get(&balance_key).unwrap_or(0))
    }

    /// Check if milestone is approved for a project
    pub fn is_milestone_approved(env: Env, project_id: u64) -> Result<bool, CrowdfundError> {
        // Check if project exists (single get instead of has + get)
        env.storage()
            .persistent()
            .get::<_, ProjectData>(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneApproved(project_id))
            .unwrap_or(false))
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Result<Address, CrowdfundError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CrowdfundError::NotInitialized)
    }

    /// Fund the matching pool (admin only)
    pub fn fund_matching_pool(
        env: Env,
        admin: Address,
        token_address: Address,
        amount: i128,
    ) -> Result<(), CrowdfundError> {
        // Verify admin (single check with helper)
        Self::verify_admin(&env, &admin)?;

        // Validate amount
        if amount <= 0 {
            return Err(CrowdfundError::InvalidAmount);
        }

        // Update matching pool balance
        let pool_key = DataKey::MatchingPool(token_address);
        let current_pool: i128 = env.storage().persistent().get(&pool_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&pool_key, &(current_pool + amount));

        Ok(())
    }

    /// Calculate matching funds for a project using quadratic funding formula
    /// Formula: (sum of sqrt(contributions))^2
    /// Returns the amount of matching funds based on number of unique contributors and amounts
    pub fn calculate_match(env: Env, project_id: u64) -> Result<i128, CrowdfundError> {
        // Check if contract is initialized
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(CrowdfundError::NotInitialized);
        }

        // Get contributor count
        let contributor_count_key = DataKey::ContributorCount(project_id);
        let contributor_count: u32 = env
            .storage()
            .persistent()
            .get(&contributor_count_key)
            .unwrap_or(0);

        if contributor_count == 0 {
            return Ok(0);
        }

        // Sum of square roots of contributions
        let mut sum_sqrt_scaled = 0i128;

        // Iterate through all contributors
        for i in 0..contributor_count {
            let contributor_key = DataKey::Contributor(project_id, i);
            let contributor: Address = env
                .storage()
                .persistent()
                .get(&contributor_key)
                .ok_or(CrowdfundError::ProjectNotFound)?;

            // Get contribution amount
            let contribution_key = DataKey::Contribution(project_id, contributor);
            let contribution: i128 = env
                .storage()
                .persistent()
                .get(&contribution_key)
                .unwrap_or(0);

            if contribution > 0 {
                // Calculate sqrt(contribution) scaled
                let sqrt_contribution_scaled = sqrt_scaled(contribution);
                sum_sqrt_scaled += sqrt_contribution_scaled;
            }
        }

        // Square the sum and unscale twice: (sum_sqrt_scaled / SCALE)^2 = sum_sqrt_scaled^2 / SCALE^2
        let sum_sqrt_squared = sum_sqrt_scaled
            .checked_mul(sum_sqrt_scaled)
            .unwrap_or(i128::MAX);
        let match_amount = unscale(unscale(sum_sqrt_squared));

        Ok(match_amount)
    }

    /// Distribute matching funds from matching pool to project balance
    pub fn distribute_match(env: Env, project_id: u64) -> Result<i128, CrowdfundError> {
        // Check if contract is initialized
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(CrowdfundError::NotInitialized);
        }

        // Get project
        let project: ProjectData = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        // Calculate matching amount
        let match_amount = Self::calculate_match(env.clone(), project_id)?;

        if match_amount <= 0 {
            return Ok(0);
        }

        // Check matching pool balance
        let pool_key = DataKey::MatchingPool(project.token_address.clone());
        let pool_balance: i128 = env.storage().persistent().get(&pool_key).unwrap_or(0);

        // Use the minimum of calculated match and available pool balance
        let actual_match = if pool_balance < match_amount {
            pool_balance
        } else {
            match_amount
        };

        if actual_match <= 0 {
            return Ok(0);
        }

        // Update matching pool balance
        env.storage()
            .persistent()
            .set(&pool_key, &(pool_balance - actual_match));

        // Update project balance
        let balance_key = DataKey::ProjectBalance(project_id, project.token_address.clone());
        let current_balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&balance_key, &(current_balance + actual_match));

        // Update project total deposited (matching funds count as deposits)
        let mut project = project;
        project.total_deposited += actual_match;
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &project);

        Ok(actual_match)
    }

    /// Get matching pool balance for a token
    pub fn get_matching_pool_balance(
        env: Env,
        token_address: Address,
    ) -> Result<i128, CrowdfundError> {
        // Check if contract is initialized
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(CrowdfundError::NotInitialized);
        }

        let pool_key = DataKey::MatchingPool(token_address);
        Ok(env.storage().persistent().get(&pool_key).unwrap_or(0))
    }

    /// Get contribution amount for a specific user and project
    pub fn get_contribution(
        env: Env,
        project_id: u64,
        contributor: Address,
    ) -> Result<i128, CrowdfundError> {
        // Check if contract is initialized
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(CrowdfundError::NotInitialized);
        }

        // Check if project exists (single get instead of has)
        env.storage()
            .persistent()
            .get::<_, ProjectData>(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        let contribution_key = DataKey::Contribution(project_id, contributor);
        Ok(env
            .storage()
            .persistent()
            .get(&contribution_key)
            .unwrap_or(0))
    }

    /// Get contributor count for a project
    pub fn get_contributor_count(env: Env, project_id: u64) -> Result<u32, CrowdfundError> {
        // Check if contract is initialized
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(CrowdfundError::NotInitialized);
        }

        // Check if project exists (single get instead of has)
        env.storage()
            .persistent()
            .get::<_, ProjectData>(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        let contributor_count_key = DataKey::ContributorCount(project_id);
        Ok(env
            .storage()
            .persistent()
            .get(&contributor_count_key)
            .unwrap_or(0))
    }

    pub fn pause(env: Env, admin: Address) -> Result<bool, CrowdfundError> {
        // Verify admin (single check with helper)
        Self::verify_admin(&env, &admin)?;

        // Check current pause state (single read)
        let is_paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);

        if is_paused {
            return Err(CrowdfundError::ContractPaused);
        }

        // Set pause state in instance storage (cheaper than persistent)
        env.storage().instance().set(&DataKey::Paused, &true);

        events::ContractPauseEvent {
            admin,
            paused: true,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        Ok(true)
    }

    pub fn unpause(env: Env, admin: Address) -> Result<bool, CrowdfundError> {
        // Verify admin (single check with helper)
        Self::verify_admin(&env, &admin)?;

        // Check current pause state (single read)
        let is_paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);

        if !is_paused {
            return Err(CrowdfundError::ContractNotPaused);
        }

        // Set pause state in instance storage (cheaper than persistent)
        env.storage().instance().set(&DataKey::Paused, &false);

        events::ContractUnpauseEvent {
            admin,
            paused: false,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        Ok(true)
    }

    pub fn require_not_paused(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Upgrade the contract WASM to a new hash.
    ///
    /// Only the stored admin may call this. Emits [`UpgradedEvent`] on success.
    pub fn upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), CrowdfundError> {
        // Verify admin (single check with helper)
        Self::verify_admin(&env, &caller)?;

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        events::UpgradedEvent {
            admin: caller,
            new_wasm_hash,
        }
        .publish(&env);
        Ok(())
    }

    /// Transfer the admin role to `new_admin`.
    ///
    /// Requires authorization from the current admin. Emits [`AdminChangedEvent`].
    pub fn set_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), CrowdfundError> {
        // Verify admin (single check with helper)
        Self::verify_admin(&env, &current_admin)?;

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
