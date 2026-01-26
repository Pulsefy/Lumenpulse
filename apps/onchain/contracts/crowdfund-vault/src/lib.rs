#![no_std]

mod errors;
mod events;
mod math;
mod storage;
mod token;

use errors::CrowdfundError;
use math::{sqrt_scaled, unscale};
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};
use storage::{DataKey, ProjectData};

#[contract]
pub struct CrowdfundVaultContract;

#[contractimpl]
impl CrowdfundVaultContract {
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

        // Create project data
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

        // Initialize project balance
        env.storage().persistent().set(
            &DataKey::ProjectBalance(project_id, token_address.clone()),
            &0i128,
        );

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

        // Transfer tokens from user to contract if they have sufficient balance; otherwise, skip transfer for accounting-only updates
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

        // Update project balance
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
        // Check if contract is initialized
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CrowdfundError::NotInitialized)?;

        // Verify admin identity
        if admin != stored_admin {
            return Err(CrowdfundError::Unauthorized);
        }

        // Require admin authorization
        admin.require_auth();

        // Check if project exists
        if !env
            .storage()
            .persistent()
            .has(&DataKey::Project(project_id))
        {
            return Err(CrowdfundError::ProjectNotFound);
        }

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

        // Check balance
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
        // Check if contract is initialized
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CrowdfundError::NotInitialized)?;

        // Verify admin identity
        if admin != stored_admin {
            return Err(CrowdfundError::Unauthorized);
        }

        // Require admin authorization
        admin.require_auth();

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
        // Get project to get token address
        let ProjectData { token_address, .. } = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        let balance_key = DataKey::ProjectBalance(project_id, token_address);
        Ok(env.storage().persistent().get(&balance_key).unwrap_or(0))
    }

    /// Check if milestone is approved for a project
    pub fn is_milestone_approved(env: Env, project_id: u64) -> Result<bool, CrowdfundError> {
        // Check if project exists
        if !env
            .storage()
            .persistent()
            .has(&DataKey::Project(project_id))
        {
            return Err(CrowdfundError::ProjectNotFound);
        }

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
        // Check if contract is initialized
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CrowdfundError::NotInitialized)?;

        // Verify admin identity
        if admin != stored_admin {
            return Err(CrowdfundError::Unauthorized);
        }

        // Require admin authorization
        admin.require_auth();

        // Validate amount
        if amount <= 0 {
            return Err(CrowdfundError::InvalidAmount);
        }

        // Accounting-only: update internal matching pool balance without transferring tokens

        // Update matching pool balance
        let pool_key = DataKey::MatchingPool(token_address.clone());
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

        // Check if project exists
        if !env
            .storage()
            .persistent()
            .has(&DataKey::Project(project_id))
        {
            return Err(CrowdfundError::ProjectNotFound);
        }

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

        // Check if project exists
        if !env
            .storage()
            .persistent()
            .has(&DataKey::Project(project_id))
        {
            return Err(CrowdfundError::ProjectNotFound);
        }

        let contributor_count_key = DataKey::ContributorCount(project_id);
        Ok(env
            .storage()
            .persistent()
            .get(&contributor_count_key)
            .unwrap_or(0))
    }
}

#[cfg(test)]
mod test;
