#![no_std]

mod errors;
mod events;
mod math;
mod storage;
mod token;
mod treasury_interface;
mod yield_provider;

use errors::CrowdfundError;
use math::{sqrt_scaled, unscale};
use notification_interface::{Notification, NotificationReceiverClient};
use reentrancy_guard::{acquire as acquire_reentrancy, release as release_reentrancy};
use soroban_sdk::token::TokenClient;
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{contract, contractimpl, vec, Address, BytesN, Env, Symbol, Vec};
use storage::{
    DataKey, MilestoneDispute, ProjectData, ProtocolStats, LEDGER_BUMP, LEDGER_THRESHOLD,
};

const CURRENT_STORAGE_VERSION: u32 = 1;
const DEFAULT_MILESTONE_EXPIRY_SECONDS: u64 = 30 * 24 * 60 * 60;
const DEFAULT_REFUND_WINDOW_SECONDS: u64 = 14 * 24 * 60 * 60;

#[contract]
pub struct CrowdfundVaultContract;

#[contractimpl]
impl CrowdfundVaultContract {
    fn get_admin_address(env: &Env) -> Result<Address, CrowdfundError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CrowdfundError::NotInitialized)
    }

    fn require_current_storage_version(env: &Env) -> Result<u32, CrowdfundError> {
        match env.storage().instance().get(&DataKey::StorageVersion) {
            Some(version) if version == CURRENT_STORAGE_VERSION => Ok(version),
            Some(_) => Err(CrowdfundError::UnsupportedStorageVersion),
            None if env.storage().instance().has(&DataKey::Admin) => {
                Err(CrowdfundError::MigrationRequired)
            }
            None => Err(CrowdfundError::NotInitialized),
        }
    }

    fn project_status(env: &Env, project_id: u64) -> Symbol {
        env.storage()
            .persistent()
            .get(&DataKey::ProjectStatus(project_id))
            .unwrap_or(Symbol::new(env, "ACTIVE"))
    }

    fn set_project_status(env: &Env, project_id: u64, status: &str) {
        env.storage().persistent().set(
            &DataKey::ProjectStatus(project_id),
            &Symbol::new(env, status),
        );
    }

    fn refund_window_deadline(env: &Env, project_id: u64) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::ProjectRefundWindowDeadline(project_id))
            .unwrap_or(0)
    }

    fn milestone_expiry_deadline(env: &Env, project_id: u64) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::ProjectMilestoneExpiry(project_id))
            .unwrap_or(0)
    }

    fn expired_refund_window_deadline(env: &Env, project_id: u64) -> u64 {
        let milestone_expiry_deadline = Self::milestone_expiry_deadline(env, project_id);
        if milestone_expiry_deadline == 0 {
            0
        } else {
            milestone_expiry_deadline + DEFAULT_REFUND_WINDOW_SECONDS
        }
    }

    fn set_refund_window_deadline(env: &Env, project_id: u64) -> u64 {
        let refund_window_deadline = Self::refund_window_deadline(env, project_id);
        if refund_window_deadline != 0 {
            return refund_window_deadline;
        }

        let refund_window_deadline = env.ledger().timestamp() + DEFAULT_REFUND_WINDOW_SECONDS;
        env.storage().persistent().set(
            &DataKey::ProjectRefundWindowDeadline(project_id),
            &refund_window_deadline,
        );
        refund_window_deadline
    }

    fn has_milestone_expired(env: &Env, project_id: u64) -> bool {
        let milestone_expiry = Self::milestone_expiry_deadline(env, project_id);
        milestone_expiry != 0 && env.ledger().timestamp() > milestone_expiry
    }

    fn expire_project(env: &Env, project_id: u64, project: &mut ProjectData) -> u64 {
        let refund_window_deadline = Self::refund_window_deadline(env, project_id);
        let refund_window_deadline = if refund_window_deadline == 0 {
            let refund_window_deadline = Self::expired_refund_window_deadline(env, project_id);
            env.storage().persistent().set(
                &DataKey::ProjectRefundWindowDeadline(project_id),
                &refund_window_deadline,
            );
            refund_window_deadline
        } else {
            refund_window_deadline
        };
        project.is_active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), project);
        Self::set_project_status(env, project_id, "EXPIRED");
        events::ProjectExpiredEvent {
            project_id,
            refund_window_deadline,
        }
        .publish(env);
        refund_window_deadline
    }

    fn fail_if_project_expired(
        env: &Env,
        project_id: u64,
        project: &mut ProjectData,
    ) -> Result<(), CrowdfundError> {
        if project.is_active && Self::has_milestone_expired(env, project_id) {
            Self::expire_project(env, project_id, project);
            return Err(CrowdfundError::MilestoneExpired);
        }
        Ok(())
    }

    fn reduce_protocol_tvl(env: &Env, amount: i128) {
        let mut stats: ProtocolStats = env
            .storage()
            .instance()
            .get(&DataKey::ProtocolStats)
            .unwrap_or(ProtocolStats {
                tvl: 0,
                cumulative_volume: 0,
            });
        stats.tvl -= amount;
        env.storage()
            .instance()
            .set(&DataKey::ProtocolStats, &stats);
    }

    /// Helper function to verify admin authorization
    /// Reduces code duplication and ensures consistent admin checks
    fn verify_admin(env: &Env, caller: &Address) -> Result<(), CrowdfundError> {
        Self::require_current_storage_version(env)?;
        let stored_admin = Self::get_admin_address(env)?;

        if caller != &stored_admin {
            return Err(CrowdfundError::Unauthorized);
        }

        caller.require_auth();
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

    fn with_reentrancy_guard<T, F>(env: &Env, f: F) -> Result<T, CrowdfundError>
    where
        F: FnOnce() -> Result<T, CrowdfundError>,
    {
        acquire_reentrancy(env).map_err(|_| CrowdfundError::Reentrancy)?;
        let result = f();
        release_reentrancy(env);
        result
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

        env.storage()
            .instance()
            .set(&DataKey::StorageVersion, &CURRENT_STORAGE_VERSION);

        // Store Emergency Pause bool
        env.storage().instance().set(&DataKey::Paused, &false);

        // Initialize project ID counter
        env.storage().instance().set(&DataKey::NextProjectId, &0u64);

        // Initialize protocol stats
        let initial_stats = ProtocolStats {
            tvl: 0i128,
            cumulative_volume: 0i128,
        };
        env.storage()
            .instance()
            .set(&DataKey::ProtocolStats, &initial_stats);

        // Emit initialization event
        events::InitializedEvent {
            admin,
            storage_version: CURRENT_STORAGE_VERSION,
        }
        .publish(&env);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        Ok(())
    }

    /// Migrate legacy initialized state to the current storage schema version.
    pub fn migrate(env: Env, admin: Address) -> Result<u32, CrowdfundError> {
        let stored_admin = Self::get_admin_address(&env)?;
        if admin != stored_admin {
            return Err(CrowdfundError::Unauthorized);
        }

        admin.require_auth();

        match env.storage().instance().get(&DataKey::StorageVersion) {
            Some(version) if version == CURRENT_STORAGE_VERSION => Ok(version),
            Some(_) => Err(CrowdfundError::UnsupportedStorageVersion),
            None => {
                env.storage()
                    .instance()
                    .set(&DataKey::StorageVersion, &CURRENT_STORAGE_VERSION);
                events::StorageMigratedEvent {
                    admin,
                    storage_version: CURRENT_STORAGE_VERSION,
                }
                .publish(&env);
                Ok(CURRENT_STORAGE_VERSION)
            }
        }
    }

    pub fn get_storage_version(env: Env) -> Result<u32, CrowdfundError> {
        Self::require_current_storage_version(&env)
    }

    /// Create a new project
    pub fn create_project(
        env: Env,
        owner: Address,
        name: Symbol,
        target_amount: i128,
        token_address: Address,
    ) -> Result<u64, CrowdfundError> {
        Self::require_current_storage_version(&env)?;

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
        env.storage().persistent().extend_ttl(
            &DataKey::Project(project_id),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        // Initialize project balance (construct key once and reuse)
        let balance_key = DataKey::ProjectBalance(project_id, token_address.clone());
        env.storage().persistent().set(&balance_key, &0i128);
        env.storage()
            .persistent()
            .extend_ttl(&balance_key, LEDGER_THRESHOLD, LEDGER_BUMP);

        // Initialize milestone approval status (first milestone is 0)
        env.storage()
            .persistent()
            .set(&DataKey::MilestoneApproved(project_id, 0), &false);
        env.storage().persistent().extend_ttl(
            &DataKey::MilestoneApproved(project_id, 0),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        let expiry_key = DataKey::ProjectMilestoneExpiry(project_id);
        env.storage().persistent().set(
            &expiry_key,
            &(env.ledger().timestamp() + DEFAULT_MILESTONE_EXPIRY_SECONDS),
        );
        env.storage()
            .persistent()
            .extend_ttl(&expiry_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        env.storage()
            .persistent()
            .set(&DataKey::ProjectRefundWindowDeadline(project_id), &0u64);
        env.storage().persistent().extend_ttl(
            &DataKey::ProjectRefundWindowDeadline(project_id),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

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
        Self::require_current_storage_version(&env)?;
        let stored_admin = Self::get_admin_address(&env)?;

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
        let refund_window_deadline = Self::set_refund_window_deadline(&env, project_id);
        env.storage().persistent().set(
            &DataKey::ProjectRefundWindowDeadline(project_id),
            &refund_window_deadline,
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
        Self::with_reentrancy_guard(&env, || {
            Self::require_current_storage_version(&env)?;
            caller.require_auth();
            let mut project: ProjectData = env
                .storage()
                .persistent()
                .get(&DataKey::Project(project_id))
                .ok_or(CrowdfundError::ProjectNotFound)?;

            if project.is_active && Self::has_milestone_expired(&env, project_id) {
                Self::expire_project(&env, project_id, &mut project);
            }

            if project.is_active {
                return Err(CrowdfundError::ProjectNotCancellable);
            }

            let status = Self::project_status(&env, project_id);

            if status != Symbol::new(&env, "CANCELED") && status != Symbol::new(&env, "EXPIRED") {
                return Err(CrowdfundError::ProjectNotCancellable);
            }

            let count_key = DataKey::ContributorCount(project_id);
            let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);

            let invested_key = DataKey::ProjectInvestedBalance(project_id);
            let current_invested: i128 = env.storage().persistent().get(&invested_key).unwrap_or(0);
            if current_invested > 0 {
                Self::divest_funds_internal(&env, project_id, current_invested)?;
            }

            let contract_address = env.current_contract_address();
            let token_client = TokenClient::new(&env, &project.token_address);
            let mut total_refunded = 0i128;

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
                    env.storage().persistent().remove(&amount_key);
                    total_refunded += amount;
                    token_client.transfer(&contract_address, &contributor, &amount);

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
            env.storage()
                .persistent()
                .remove(&DataKey::ProjectRefundWindowDeadline(project_id));
            env.storage()
                .persistent()
                .remove(&DataKey::ProjectStatus(project_id));
            env.storage()
                .persistent()
                .remove(&DataKey::ProjectMilestoneExpiry(project_id));
            env.storage()
                .persistent()
                .remove(&DataKey::MilestoneApproved(project_id, 0));
            Self::reduce_protocol_tvl(&env, total_refunded);

            Ok(())
        })
    }

    pub fn clawback_contribution(
        env: Env,
        project_id: u64,
        contributor: Address,
    ) -> Result<i128, CrowdfundError> {
        Self::with_reentrancy_guard(&env, || {
            Self::require_current_storage_version(&env)?;
            contributor.require_auth();

            let mut project: ProjectData = env
                .storage()
                .persistent()
                .get(&DataKey::Project(project_id))
                .ok_or(CrowdfundError::ProjectNotFound)?;

            if project.is_active && Self::has_milestone_expired(&env, project_id) {
                Self::expire_project(&env, project_id, &mut project);
            }

            let status = Self::project_status(&env, project_id);
            if status != Symbol::new(&env, "CANCELED") && status != Symbol::new(&env, "EXPIRED") {
                return Err(CrowdfundError::RefundWindowNotOpen);
            }

            let refund_window_deadline = match Self::refund_window_deadline(&env, project_id) {
                0 if status == Symbol::new(&env, "EXPIRED") => {
                    Self::expired_refund_window_deadline(&env, project_id)
                }
                deadline => deadline,
            };
            if refund_window_deadline == 0 {
                return Err(CrowdfundError::RefundWindowNotOpen);
            }
            if env.ledger().timestamp() > refund_window_deadline {
                return Err(CrowdfundError::RefundWindowClosed);
            }

            let amount_key = DataKey::Contribution(project_id, contributor.clone());
            let amount: i128 = env.storage().persistent().get(&amount_key).unwrap_or(0);
            if amount <= 0 {
                return Err(CrowdfundError::InsufficientBalance);
            }

            let balance_key = DataKey::ProjectBalance(project_id, project.token_address.clone());
            let total_balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
            let invested_key = DataKey::ProjectInvestedBalance(project_id);
            let current_invested: i128 = env.storage().persistent().get(&invested_key).unwrap_or(0);
            let local_balance = total_balance - current_invested;

            if local_balance < amount {
                Self::divest_funds_internal(&env, project_id, amount - local_balance)?;
            }

            env.storage().persistent().remove(&amount_key);
            env.storage()
                .persistent()
                .set(&balance_key, &(total_balance - amount));
            Self::reduce_protocol_tvl(&env, amount);

            let contract_address = env.current_contract_address();
            token::transfer(
                &env,
                &project.token_address,
                &contract_address,
                &contributor,
                &amount,
            );

            events::ContributionClawedBackEvent {
                project_id,
                contributor,
                amount,
                refund_window_deadline,
            }
            .publish(&env);

            Ok(amount)
        })
    }

    /// Deposit funds into a project
    pub fn deposit(
        env: Env,
        user: Address,
        project_id: u64,
        amount: i128,
    ) -> Result<(), CrowdfundError> {
        Self::with_reentrancy_guard(&env, || {
            Self::require_current_storage_version(&env)?;

            user.require_auth();

            let is_paused: bool = env
                .storage()
                .instance()
                .get(&DataKey::Paused)
                .unwrap_or(false);
            if is_paused {
                return Err(CrowdfundError::ContractPaused);
            }

            if amount <= 0 {
                return Err(CrowdfundError::InvalidAmount);
            }

            let mut project: ProjectData = env
                .storage()
                .persistent()
                .get(&DataKey::Project(project_id))
                .ok_or(CrowdfundError::ProjectNotFound)?;

            Self::fail_if_project_expired(&env, project_id, &mut project)?;

            if !project.is_active {
                return Err(CrowdfundError::ProjectNotActive);
            }

            let contract_address = env.current_contract_address();
            let user_balance = token::balance(&env, &project.token_address, &user);

            let balance_key = DataKey::ProjectBalance(project_id, project.token_address.clone());
            let current_balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
            env.storage()
                .persistent()
                .set(&balance_key, &(current_balance + amount));
            env.storage()
                .persistent()
                .extend_ttl(&balance_key, LEDGER_THRESHOLD, LEDGER_BUMP);

            let contribution_key = DataKey::Contribution(project_id, user.clone());
            let current_contribution: i128 = env
                .storage()
                .persistent()
                .get(&contribution_key)
                .unwrap_or(0);

            if current_contribution == 0 {
                let contributor_count_key = DataKey::ContributorCount(project_id);
                let contributor_count: u32 = env
                    .storage()
                    .persistent()
                    .get(&contributor_count_key)
                    .unwrap_or(0);

                let contrib_idx_key = DataKey::Contributor(project_id, contributor_count);
                env.storage().persistent().set(&contrib_idx_key, &user);
                env.storage().persistent().extend_ttl(
                    &contrib_idx_key,
                    LEDGER_THRESHOLD,
                    LEDGER_BUMP,
                );

                env.storage()
                    .persistent()
                    .set(&contributor_count_key, &(contributor_count + 1));
                env.storage().persistent().extend_ttl(
                    &contributor_count_key,
                    LEDGER_THRESHOLD,
                    LEDGER_BUMP,
                );
            }

            env.storage()
                .persistent()
                .set(&contribution_key, &(current_contribution + amount));
            env.storage()
                .persistent()
                .extend_ttl(&contribution_key, LEDGER_THRESHOLD, LEDGER_BUMP);

            project.total_deposited += amount;
            env.storage()
                .persistent()
                .set(&DataKey::Project(project_id), &project);
            env.storage().persistent().extend_ttl(
                &DataKey::Project(project_id),
                LEDGER_THRESHOLD,
                LEDGER_BUMP,
            );

            let mut stats: ProtocolStats = env
                .storage()
                .instance()
                .get(&DataKey::ProtocolStats)
                .unwrap_or(ProtocolStats {
                    tvl: 0,
                    cumulative_volume: 0,
                });
            stats.tvl += amount;
            stats.cumulative_volume += amount;
            env.storage()
                .instance()
                .set(&DataKey::ProtocolStats, &stats);

            if user_balance >= amount {
                token::transfer(
                    &env,
                    &project.token_address,
                    &user,
                    &contract_address,
                    &amount,
                );
            }

            events::DepositEvent {
                user: user.clone(),
                project_id,
                amount,
            }
            .publish(&env);

            Self::notify_subscribers(
                &env,
                Symbol::new(&env, "deposit"),
                (user, project_id, amount).to_xdr(&env),
            );

            Ok(())
        })
    }

    /// Add a notification subscriber (admin only)
    pub fn add_subscriber(
        env: Env,
        admin: Address,
        subscriber: Address,
    ) -> Result<(), CrowdfundError> {
        Self::verify_admin(&env, &admin)?;
        let mut subscribers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Subscribers)
            .unwrap_or(vec![&env]);
        if !subscribers.contains(&subscriber) {
            subscribers.push_back(subscriber);
            env.storage()
                .instance()
                .set(&DataKey::Subscribers, &subscribers);
        }
        Ok(())
    }

    /// Remove a notification subscriber (admin only)
    pub fn remove_subscriber(
        env: Env,
        admin: Address,
        subscriber: Address,
    ) -> Result<(), CrowdfundError> {
        Self::verify_admin(&env, &admin)?;
        let mut subscribers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Subscribers)
            .unwrap_or(vec![&env]);
        if let Some(index) = subscribers.first_index_of(&subscriber) {
            subscribers.remove(index);
            env.storage()
                .instance()
                .set(&DataKey::Subscribers, &subscribers);
        }
        Ok(())
    }

    /// Internal helper to notify all subscribers
    fn notify_subscribers(env: &Env, event_type: Symbol, data: soroban_sdk::Bytes) {
        let subscribers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Subscribers)
            .unwrap_or(vec![env]);
        let notification = Notification {
            source: env.current_contract_address(),
            event_type,
            data,
        };

        for subscriber in subscribers {
            let client = NotificationReceiverClient::new(env, &subscriber);
            client.on_notify(&notification);
        }
    }

    /// Approve milestone for a project (admin only)
    pub fn approve_milestone(
        env: Env,
        admin: Address,
        project_id: u64,
        milestone_id: u32,
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

        let mut project: ProjectData = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;
        Self::fail_if_project_expired(&env, project_id, &mut project)?;

        // Approve milestone
        env.storage()
            .persistent()
            .set(&DataKey::MilestoneApproved(project_id, milestone_id), &true);
        env.storage().persistent().set(
            &DataKey::MilestoneDisputed(project_id, milestone_id),
            &false,
        );

        // Emit milestone approval event
        events::MilestoneApprovedEvent {
            admin,
            project_id,
            milestone_id,
        }
        .publish(&env);

        Ok(())
    }

    /// Start a vote for a milestone approval
    pub fn start_milestone_vote(
        env: Env,
        project_id: u64,
        milestone_id: u32,
        duration_seconds: u64,
    ) -> Result<(), CrowdfundError> {
        Self::require_current_storage_version(&env)?;
        // Get project
        let mut project: ProjectData = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        Self::fail_if_project_expired(&env, project_id, &mut project)?;

        if !project.is_active {
            return Err(CrowdfundError::ProjectNotActive);
        }

        // Only project owner can start a vote
        project.owner.require_auth();

        // Check if already approved
        let is_approved: bool = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneApproved(project_id, milestone_id))
            .unwrap_or(false);
        if is_approved {
            return Err(CrowdfundError::MilestoneAlreadyApproved);
        }

        // Set voting window
        let end_time = env.ledger().timestamp() + duration_seconds;
        env.storage().persistent().set(
            &DataKey::MilestoneVoteWindow(project_id, milestone_id),
            &end_time,
        );

        // Reset votes for this milestone if needed (though they should be 0)
        env.storage().persistent().set(
            &DataKey::MilestoneVotesFor(project_id, milestone_id),
            &0i128,
        );
        env.storage().persistent().set(
            &DataKey::MilestoneVotesAgainst(project_id, milestone_id),
            &0i128,
        );

        // Emit event
        events::MilestoneVoteStartedEvent {
            project_id,
            milestone_id,
            end_time,
        }
        .publish(&env);

        Ok(())
    }

    /// Cast a vote for a milestone
    pub fn vote_milestone(
        env: Env,
        voter: Address,
        project_id: u64,
        milestone_id: u32,
        support: bool,
    ) -> Result<(), CrowdfundError> {
        Self::require_current_storage_version(&env)?;
        voter.require_auth();

        let mut project: ProjectData = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        Self::fail_if_project_expired(&env, project_id, &mut project)?;

        if !project.is_active {
            return Err(CrowdfundError::ProjectNotActive);
        }

        // Check voting window
        let end_time: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneVoteWindow(project_id, milestone_id))
            .ok_or(CrowdfundError::VotingWindowNotStarted)?;

        if env.ledger().timestamp() > end_time {
            return Err(CrowdfundError::VotingWindowClosed);
        }

        // Check if already voted
        if env.storage().persistent().has(&DataKey::MilestoneVote(
            project_id,
            milestone_id,
            voter.clone(),
        )) {
            return Err(CrowdfundError::AlreadyVoted);
        }

        // Get contribution weight
        let weight: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Contribution(project_id, voter.clone()))
            .unwrap_or(0);

        if weight <= 0 {
            return Err(CrowdfundError::InsufficientContributionToVote);
        }

        // Update vote count
        if support {
            let current_for: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::MilestoneVotesFor(project_id, milestone_id))
                .unwrap_or(0);
            env.storage().persistent().set(
                &DataKey::MilestoneVotesFor(project_id, milestone_id),
                &(current_for + weight),
            );
        } else {
            let current_against: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::MilestoneVotesAgainst(project_id, milestone_id))
                .unwrap_or(0);
            env.storage().persistent().set(
                &DataKey::MilestoneVotesAgainst(project_id, milestone_id),
                &(current_against + weight),
            );
        }

        // Mark as voted
        env.storage().persistent().set(
            &DataKey::MilestoneVote(project_id, milestone_id, voter.clone()),
            &true,
        );

        // Emit event
        events::VoteCastEvent {
            project_id,
            milestone_id,
            voter,
            weight,
            support,
        }
        .publish(&env);

        // Auto-approve if threshold met (> 50% of total deposited)
        let current_for: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneVotesFor(project_id, milestone_id))
            .unwrap_or(0);

        if current_for > project.total_deposited / 2 {
            env.storage()
                .persistent()
                .set(&DataKey::MilestoneApproved(project_id, milestone_id), &true);
            env.storage().persistent().set(
                &DataKey::MilestoneDisputed(project_id, milestone_id),
                &false,
            );
            events::MilestoneApprovedByVoteEvent {
                project_id,
                milestone_id,
            }
            .publish(&env);
        }

        Ok(())
    }

    /// Withdraw funds from a project (owner only, requires milestone approval)
    pub fn withdraw(
        env: Env,
        project_id: u64,
        milestone_id: u32,
        amount: i128,
    ) -> Result<(), CrowdfundError> {
        Self::with_reentrancy_guard(&env, || {
            Self::require_current_storage_version(&env)?;

            let is_paused: bool = env
                .storage()
                .instance()
                .get(&DataKey::Paused)
                .unwrap_or(false);
            if is_paused {
                return Err(CrowdfundError::ContractPaused);
            }

            let mut project: ProjectData = env
                .storage()
                .persistent()
                .get(&DataKey::Project(project_id))
                .ok_or(CrowdfundError::ProjectNotFound)?;

            project.owner.require_auth();

            Self::fail_if_project_expired(&env, project_id, &mut project)?;

            if !project.is_active {
                return Err(CrowdfundError::ProjectNotActive);
            }

            if amount <= 0 {
                return Err(CrowdfundError::InvalidAmount);
            }

            let is_approved: bool = env
                .storage()
                .persistent()
                .get(&DataKey::MilestoneApproved(project_id, milestone_id))
                .unwrap_or(false);

            if !is_approved {
                return Err(CrowdfundError::MilestoneNotApproved);
            }

            let is_disputed: bool = env
                .storage()
                .persistent()
                .get(&DataKey::MilestoneDisputed(project_id, milestone_id))
                .unwrap_or(false);
            if is_disputed {
                return Err(CrowdfundError::MilestoneEscrowed);
            }

            let balance_key = DataKey::ProjectBalance(project_id, project.token_address.clone());
            let total_balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);

            if total_balance < amount {
                return Err(CrowdfundError::InsufficientBalance);
            }

            let invested_key = DataKey::ProjectInvestedBalance(project_id);
            let current_invested: i128 = env.storage().persistent().get(&invested_key).unwrap_or(0);
            let local_balance = total_balance - current_invested;

            let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
            let treasury: Option<Address> = env.storage().instance().get(&DataKey::Treasury);

            let fee_amount = if treasury.is_some() && fee_bps > 0 {
                (amount.checked_mul(fee_bps as i128).unwrap_or(0)) / 10_000
            } else {
                0
            };

            let withdraw_amount = amount - fee_amount;

            env.storage()
                .persistent()
                .set(&balance_key, &(total_balance - amount));
            env.storage()
                .persistent()
                .extend_ttl(&balance_key, LEDGER_THRESHOLD, LEDGER_BUMP);

            project.total_withdrawn += amount;
            env.storage()
                .persistent()
                .set(&DataKey::Project(project_id), &project);
            env.storage().persistent().extend_ttl(
                &DataKey::Project(project_id),
                LEDGER_THRESHOLD,
                LEDGER_BUMP,
            );
            let expiry_key = DataKey::ProjectMilestoneExpiry(project_id);
            env.storage().persistent().set(
                &expiry_key,
                &(env.ledger().timestamp() + DEFAULT_MILESTONE_EXPIRY_SECONDS),
            );
            env.storage()
                .persistent()
                .extend_ttl(&expiry_key, LEDGER_THRESHOLD, LEDGER_BUMP);
            env.storage()
                .persistent()
                .remove(&DataKey::ProjectRefundWindowDeadline(project_id));

            let mut stats: ProtocolStats = env
                .storage()
                .instance()
                .get(&DataKey::ProtocolStats)
                .unwrap_or(ProtocolStats {
                    tvl: 0,
                    cumulative_volume: 0,
                });
            stats.tvl -= amount;
            env.storage()
                .instance()
                .set(&DataKey::ProtocolStats, &stats);

            if local_balance < amount {
                let amount_to_divest = amount - local_balance;
                Self::divest_funds_internal(&env, project_id, amount_to_divest)?;
            }

            let contract_address = env.current_contract_address();
            if fee_amount > 0 {
                token::transfer(
                    &env,
                    &project.token_address,
                    &contract_address,
                    &treasury.clone().unwrap(),
                    &fee_amount,
                );
                events::ProtocolFeeDeductedEvent {
                    project_id,
                    amount: fee_amount,
                }
                .publish(&env);
            }

            token::transfer(
                &env,
                &project.token_address,
                &contract_address,
                &project.owner,
                &withdraw_amount,
            );

            events::WithdrawEvent {
                owner: project.owner,
                project_id,
                amount: withdraw_amount,
            }
            .publish(&env);

            Ok(())
        })
    }

    /// Allocate approved milestone funds to a streaming treasury for gradual unlocking.
    /// This allows projects to have their budget streamed over time instead of receiving it all at once.
    pub fn allocate_to_streaming_treasury(
        env: Env,
        admin: Address,
        project_id: u64,
        milestone_id: u32,
        treasury_contract: Address,
        amount: i128,
        duration: u64,
    ) -> Result<(), CrowdfundError> {
        Self::with_reentrancy_guard(&env, || {
            Self::verify_admin(&env, &admin)?;

            let mut project: ProjectData = env
                .storage()
                .persistent()
                .get(&DataKey::Project(project_id))
                .ok_or(CrowdfundError::ProjectNotFound)?;

            let is_approved: bool = env
                .storage()
                .persistent()
                .get(&DataKey::MilestoneApproved(project_id, milestone_id))
                .unwrap_or(false);

            if !is_approved {
                return Err(CrowdfundError::MilestoneNotApproved);
            }

            let balance_key = DataKey::ProjectBalance(project_id, project.token_address.clone());
            let total_balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);

            if total_balance < amount {
                return Err(CrowdfundError::InsufficientBalance);
            }

            // Deduct from project balance
            env.storage()
                .persistent()
                .set(&balance_key, &(total_balance - amount));

            project.total_withdrawn += amount;
            env.storage()
                .persistent()
                .set(&DataKey::Project(project_id), &project);

            // Transfer to treasury contract
            let contract_address = env.current_contract_address();
            token::transfer(
                &env,
                &project.token_address,
                &contract_address,
                &treasury_contract,
                &amount,
            );

            // Call treasury contract to start stream
            let treasury_client = treasury_interface::TreasuryClient::new(&env, &treasury_contract);
            let start_time = env.ledger().timestamp();

            // The treasury contract expects the admin to authorize the allocation.
            // We pass the admin address here.
            treasury_client.allocate_budget(
                &admin,
                &project.owner,
                &amount,
                &start_time,
                &duration,
            );

            Ok(())
        })
    }

    /// Formally challenge a completed milestone and escrow further payouts.
    pub fn dispute_milestone(
        env: Env,
        challenger: Address,
        project_id: u64,
        milestone_id: u32,
        reason: Symbol,
    ) -> Result<(), CrowdfundError> {
        challenger.require_auth();

        env.storage()
            .persistent()
            .get::<_, ProjectData>(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        let is_approved: bool = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneApproved(project_id, milestone_id))
            .unwrap_or(false);
        if !is_approved {
            return Err(CrowdfundError::MilestoneNotApproved);
        }

        let contribution: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Contribution(project_id, challenger.clone()))
            .unwrap_or(0);
        if contribution <= 0 {
            return Err(CrowdfundError::InsufficientContributionToVote);
        }

        let is_disputed: bool = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneDisputed(project_id, milestone_id))
            .unwrap_or(false);
        if is_disputed {
            return Err(CrowdfundError::MilestoneAlreadyDisputed);
        }

        let dispute = MilestoneDispute {
            project_id,
            milestone_id,
            challenger: challenger.clone(),
            opened_at: env.ledger().timestamp(),
            reason,
        };

        env.storage().persistent().set(
            &DataKey::MilestoneDispute(project_id, milestone_id),
            &dispute,
        );
        env.storage()
            .persistent()
            .set(&DataKey::MilestoneDisputed(project_id, milestone_id), &true);

        events::MilestoneDisputedEvent {
            project_id,
            milestone_id,
            challenger,
            reason: dispute.reason.clone(),
        }
        .publish(&env);

        Ok(())
    }

    /// Resolve a milestone dispute and either restore or revoke payout eligibility.
    pub fn resolve_milestone_dispute(
        env: Env,
        admin: Address,
        project_id: u64,
        milestone_id: u32,
        upheld_completion: bool,
    ) -> Result<(), CrowdfundError> {
        Self::verify_admin(&env, &admin)?;

        env.storage()
            .persistent()
            .get::<_, MilestoneDispute>(&DataKey::MilestoneDispute(project_id, milestone_id))
            .ok_or(CrowdfundError::MilestoneNotDisputed)?;

        env.storage().persistent().set(
            &DataKey::MilestoneDisputed(project_id, milestone_id),
            &false,
        );
        env.storage()
            .persistent()
            .remove(&DataKey::MilestoneDispute(project_id, milestone_id));
        env.storage().persistent().set(
            &DataKey::MilestoneApproved(project_id, milestone_id),
            &upheld_completion,
        );

        events::MilestoneDisputeResolvedEvent {
            admin,
            project_id,
            milestone_id,
            upheld_completion,
        }
        .publish(&env);

        Ok(())
    }

    /// Register a new contributor
    pub fn register_contributor(env: Env, contributor: Address) -> Result<(), CrowdfundError> {
        Self::require_current_storage_version(&env)?;
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
        env.storage().persistent().extend_ttl(
            &DataKey::RegisteredContributor(contributor.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        // Initialize reputation
        env.storage()
            .persistent()
            .set(&DataKey::Reputation(contributor.clone()), &0i128);
        env.storage().persistent().extend_ttl(
            &DataKey::Reputation(contributor.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

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
        env.storage().persistent().extend_ttl(
            &DataKey::Reputation(contributor.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

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
        Self::require_current_storage_version(&env)?;
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
        Self::require_current_storage_version(&env)?;
        let key = DataKey::Project(project_id);
        let data = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(CrowdfundError::ProjectNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(data)
    }

    /// Get project balance
    pub fn get_balance(env: Env, project_id: u64) -> Result<i128, CrowdfundError> {
        Self::require_current_storage_version(&env)?;
        // Get project to get token address (use destructuring to avoid full clone)
        let project_key = DataKey::Project(project_id);
        let project: ProjectData = env
            .storage()
            .persistent()
            .get(&project_key)
            .ok_or(CrowdfundError::ProjectNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&project_key, LEDGER_THRESHOLD, LEDGER_BUMP);

        let balance_key = DataKey::ProjectBalance(project_id, project.token_address);
        let balance = env.storage().persistent().get(&balance_key).unwrap_or(0);
        env.storage()
            .persistent()
            .extend_ttl(&balance_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(balance)
    }

    /// Check if milestone is approved for a project
    pub fn is_milestone_approved(
        env: Env,
        project_id: u64,
        milestone_id: u32,
    ) -> Result<bool, CrowdfundError> {
        Self::require_current_storage_version(&env)?;
        // Check if project exists (single get instead of has + get)
        let project_key = DataKey::Project(project_id);
        env.storage()
            .persistent()
            .get::<_, ProjectData>(&project_key)
            .ok_or(CrowdfundError::ProjectNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&project_key, LEDGER_THRESHOLD, LEDGER_BUMP);

        let milestone_key = DataKey::MilestoneApproved(project_id, milestone_id);
        let approved = env
            .storage()
            .persistent()
            .get(&milestone_key)
            .unwrap_or(false);
        if env.storage().persistent().has(&milestone_key) {
            env.storage()
                .persistent()
                .extend_ttl(&milestone_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        Ok(approved)
    }

    pub fn is_milestone_disputed(
        env: Env,
        project_id: u64,
        milestone_id: u32,
    ) -> Result<bool, CrowdfundError> {
        env.storage()
            .persistent()
            .get::<_, ProjectData>(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneDisputed(project_id, milestone_id))
            .unwrap_or(false))
    }

    pub fn get_milestone_dispute(
        env: Env,
        project_id: u64,
        milestone_id: u32,
    ) -> Result<MilestoneDispute, CrowdfundError> {
        env.storage()
            .persistent()
            .get::<_, ProjectData>(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        env.storage()
            .persistent()
            .get(&DataKey::MilestoneDispute(project_id, milestone_id))
            .ok_or(CrowdfundError::MilestoneNotDisputed)
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Result<Address, CrowdfundError> {
        Self::require_current_storage_version(&env)?;
        Self::get_admin_address(&env)
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
        env.storage()
            .persistent()
            .extend_ttl(&pool_key, LEDGER_THRESHOLD, LEDGER_BUMP);

        Ok(())
    }

    /// Fund the reward pool (admin only)
    pub fn fund_reward_pool(
        env: Env,
        admin: Address,
        token_address: Address,
        amount: i128,
    ) -> Result<(), CrowdfundError> {
        Self::with_reentrancy_guard(&env, || {
            Self::verify_admin(&env, &admin)?;

            if amount <= 0 {
                return Err(CrowdfundError::InvalidAmount);
            }

            let pool_key = DataKey::RewardPool(token_address.clone());
            let current_pool: i128 = env.storage().persistent().get(&pool_key).unwrap_or(0);
            env.storage()
                .persistent()
                .set(&pool_key, &(current_pool + amount));
            env.storage()
                .persistent()
                .extend_ttl(&pool_key, LEDGER_THRESHOLD, LEDGER_BUMP);

            let contract_address = env.current_contract_address();
            token::transfer(&env, &token_address, &admin, &contract_address, &amount);

            Ok(())
        })
    }

    /// Calculate matching funds for a project using quadratic funding formula
    /// Formula: (sum of sqrt(contributions))^2
    /// Returns the amount of matching funds based on number of unique contributors and amounts
    pub fn calculate_match(env: Env, project_id: u64) -> Result<i128, CrowdfundError> {
        Self::require_current_storage_version(&env)?;

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
        Self::with_reentrancy_guard(&env, || {
            Self::require_current_storage_version(&env)?;

            let is_paused: bool = env
                .storage()
                .instance()
                .get(&DataKey::Paused)
                .unwrap_or(false);
            if is_paused {
                return Err(CrowdfundError::ContractPaused);
            }

            let project: ProjectData = env
                .storage()
                .persistent()
                .get(&DataKey::Project(project_id))
                .ok_or(CrowdfundError::ProjectNotFound)?;

            let match_amount = Self::calculate_match(env.clone(), project_id)?;

            if match_amount <= 0 {
                return Ok(0);
            }

            let pool_key = DataKey::MatchingPool(project.token_address.clone());
            let pool_balance: i128 = env.storage().persistent().get(&pool_key).unwrap_or(0);

            let actual_match = if pool_balance < match_amount {
                pool_balance
            } else {
                match_amount
            };

            if actual_match <= 0 {
                return Ok(0);
            }

            let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
            let treasury: Option<Address> = env.storage().instance().get(&DataKey::Treasury);

            let fee_amount = if treasury.is_some() && fee_bps > 0 {
                (actual_match.checked_mul(fee_bps as i128).unwrap_or(0)) / 10_000
            } else {
                0
            };

            let match_after_fee = actual_match - fee_amount;

            env.storage()
                .persistent()
                .set(&pool_key, &(pool_balance - actual_match));

            let balance_key = DataKey::ProjectBalance(project_id, project.token_address.clone());
            let current_balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
            env.storage()
                .persistent()
                .set(&balance_key, &(current_balance + match_after_fee));

            let mut project = project;
            project.total_deposited += match_after_fee;
            env.storage()
                .persistent()
                .set(&DataKey::Project(project_id), &project);

            if fee_amount > 0 {
                let contract_address = env.current_contract_address();
                token::transfer(
                    &env,
                    &project.token_address,
                    &contract_address,
                    &treasury.unwrap(),
                    &fee_amount,
                );
                events::ProtocolFeeDeductedEvent {
                    project_id,
                    amount: fee_amount,
                }
                .publish(&env);
            }

            Ok(match_after_fee)
        })
    }

    /// Get matching pool balance for a token
    pub fn get_matching_pool_balance(
        env: Env,
        token_address: Address,
    ) -> Result<i128, CrowdfundError> {
        Self::require_current_storage_version(&env)?;

        let pool_key = DataKey::MatchingPool(token_address);
        Ok(env.storage().persistent().get(&pool_key).unwrap_or(0))
    }

    /// Get reward pool balance for a token
    pub fn get_reward_pool_balance(
        env: Env,
        token_address: Address,
    ) -> Result<i128, CrowdfundError> {
        // Check if contract is initialized
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(CrowdfundError::NotInitialized);
        }

        let pool_key = DataKey::RewardPool(token_address);
        Ok(env.storage().persistent().get(&pool_key).unwrap_or(0))
    }

    /// Batch payout tokens to multiple contributors (admin only)
    /// Transfers tokens from the reward pool to each recipient.
    pub fn batch_payout(
        env: Env,
        admin: Address,
        token_address: Address,
        recipients: Vec<(Address, i128)>,
    ) -> Result<(), CrowdfundError> {
        Self::with_reentrancy_guard(&env, || {
            Self::verify_admin(&env, &admin)?;

            let is_paused: bool = env
                .storage()
                .instance()
                .get(&DataKey::Paused)
                .unwrap_or(false);
            if is_paused {
                return Err(CrowdfundError::ContractPaused);
            }

            if recipients.is_empty() {
                return Err(CrowdfundError::InvalidAmount);
            }

            let contract_address = env.current_contract_address();

            let mut total_amount: i128 = 0;
            for tuple in recipients.iter() {
                let recipient = &tuple.0;
                let amount = &tuple.1;
                if *amount <= 0 {
                    return Err(CrowdfundError::InvalidAmount);
                }
                if *recipient == contract_address {
                    return Err(CrowdfundError::InvalidRecipient);
                }
                total_amount = total_amount
                    .checked_add(*amount)
                    .ok_or(CrowdfundError::InvalidAmount)?;
            }

            let pool_key = DataKey::RewardPool(token_address.clone());
            let pool_balance: i128 = env.storage().persistent().get(&pool_key).unwrap_or(0);
            if pool_balance < total_amount {
                return Err(CrowdfundError::InsufficientBalance);
            }

            let new_pool_balance = pool_balance
                .checked_sub(total_amount)
                .ok_or(CrowdfundError::InvalidAmount)?;
            env.storage().persistent().set(&pool_key, &new_pool_balance);

            for (recipient, amount) in recipients {
                token::transfer(&env, &token_address, &contract_address, &recipient, &amount);
                events::ContributorPayoutEvent { recipient, amount }.publish(&env);
            }

            Ok(())
        })
    }

    /// Get contribution amount for a specific user and project
    pub fn get_contribution(
        env: Env,
        project_id: u64,
        contributor: Address,
    ) -> Result<i128, CrowdfundError> {
        Self::require_current_storage_version(&env)?;

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
        Self::require_current_storage_version(&env)?;

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

    /// Set protocol fee configuration
    pub fn set_fee_config(
        env: Env,
        admin: Address,
        fee_bps: u32,
        treasury: Address,
    ) -> Result<(), CrowdfundError> {
        Self::verify_admin(&env, &admin)?;

        if fee_bps > 10_000 {
            return Err(CrowdfundError::InvalidAmount);
        }

        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::Treasury, &treasury);

        events::FeeConfigChangedEvent {
            admin,
            fee_bps,
            treasury,
        }
        .publish(&env);

        Ok(())
    }

    /// Get total contributions for a project
    pub fn get_total_contributions(env: Env, project_id: u64) -> Result<i128, CrowdfundError> {
        let project: ProjectData = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        Ok(project.total_deposited)
    }

    /// Get a specific contributor's contribution to a project
    pub fn get_contributor_contribution(
        env: Env,
        project_id: u64,
        contributor: Address,
    ) -> Result<i128, CrowdfundError> {
        Self::get_contribution(env, project_id, contributor)
    }

    /// Get project status
    pub fn get_project_status(env: Env, project_id: u64) -> Result<Symbol, CrowdfundError> {
        Self::require_current_storage_version(&env)?;
        // Check if project exists
        let project: ProjectData = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        if project.is_active && Self::has_milestone_expired(&env, project_id) {
            return Ok(Symbol::new(&env, "EXPIRED"));
        }

        Ok(Self::project_status(&env, project_id))
    }

    /// Set yield provider for a token (admin only)
    pub fn set_yield_provider(
        env: Env,
        admin: Address,
        token_address: Address,
        yield_provider: Address,
    ) -> Result<(), CrowdfundError> {
        Self::verify_admin(&env, &admin)?;

        env.storage()
            .persistent()
            .set(&DataKey::YieldProvider(token_address), &yield_provider);

        Ok(())
    }

    /// Invest idle funds into the yield provider
    pub fn invest_idle_funds(
        env: Env,
        caller: Address,
        project_id: u64,
        amount: i128,
    ) -> Result<(), CrowdfundError> {
        Self::with_reentrancy_guard(&env, || {
            Self::require_current_storage_version(&env)?;
            caller.require_auth();

            let project: ProjectData = env
                .storage()
                .persistent()
                .get(&DataKey::Project(project_id))
                .ok_or(CrowdfundError::ProjectNotFound)?;

            if !project.is_active {
                return Err(CrowdfundError::ProjectNotActive);
            }

            let stored_admin = Self::get_admin_address(&env)?;

            if caller != stored_admin && caller != project.owner {
                return Err(CrowdfundError::Unauthorized);
            }

            Self::invest_funds_internal(&env, project_id, amount)
        })
    }

    /// Divest funds from the yield provider
    pub fn divest_funds(
        env: Env,
        caller: Address,
        project_id: u64,
        amount: i128,
    ) -> Result<(), CrowdfundError> {
        Self::with_reentrancy_guard(&env, || {
            Self::require_current_storage_version(&env)?;
            caller.require_auth();

            let project: ProjectData = env
                .storage()
                .persistent()
                .get(&DataKey::Project(project_id))
                .ok_or(CrowdfundError::ProjectNotFound)?;

            let stored_admin = Self::get_admin_address(&env)?;

            if caller != stored_admin && caller != project.owner {
                return Err(CrowdfundError::Unauthorized);
            }

            Self::divest_funds_internal(&env, project_id, amount)
        })
    }

    /// Internal function to invest funds
    fn invest_funds_internal(
        env: &Env,
        project_id: u64,
        amount: i128,
    ) -> Result<(), CrowdfundError> {
        let project: ProjectData = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        let yield_provider_addr: Address = env
            .storage()
            .persistent()
            .get(&DataKey::YieldProvider(project.token_address.clone()))
            .ok_or(CrowdfundError::YieldProviderNotFound)?;

        let balance_key = DataKey::ProjectBalance(project_id, project.token_address.clone());
        let total_balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);

        let invested_key = DataKey::ProjectInvestedBalance(project_id);
        let current_invested: i128 = env.storage().persistent().get(&invested_key).unwrap_or(0);

        let local_balance = total_balance - current_invested;
        if local_balance < amount {
            return Err(CrowdfundError::InsufficientBalance);
        }

        env.storage()
            .persistent()
            .set(&invested_key, &(current_invested + amount));

        let contract_address = env.current_contract_address();
        let token_client = TokenClient::new(env, &project.token_address);
        token_client.transfer(&contract_address, &yield_provider_addr, &amount);

        let yield_client = yield_provider::YieldProviderClient::new(env, &yield_provider_addr);
        yield_client.deposit(&contract_address, &amount);

        Ok(())
    }

    /// Internal function to divest funds
    fn divest_funds_internal(
        env: &Env,
        project_id: u64,
        amount: i128,
    ) -> Result<(), CrowdfundError> {
        let project: ProjectData = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(CrowdfundError::ProjectNotFound)?;

        let yield_provider_addr: Address = env
            .storage()
            .persistent()
            .get(&DataKey::YieldProvider(project.token_address.clone()))
            .ok_or(CrowdfundError::YieldProviderNotFound)?;

        let invested_key = DataKey::ProjectInvestedBalance(project_id);
        let current_invested: i128 = env.storage().persistent().get(&invested_key).unwrap_or(0);

        if current_invested < amount {
            return Err(CrowdfundError::InsufficientBalance);
        }

        env.storage()
            .persistent()
            .set(&invested_key, &(current_invested - amount));

        let contract_address = env.current_contract_address();
        let yield_client = yield_provider::YieldProviderClient::new(env, &yield_provider_addr);
        yield_client.withdraw(&contract_address, &amount);

        Ok(())
    }
}

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_yield;
#[cfg(test)]
mod tests;
