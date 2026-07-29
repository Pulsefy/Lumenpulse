#![no_std]

mod errors;
mod events;
mod storage;

use errors::TreasuryError;
use multisig_guard::{
    cancel as multisig_cancel, configure as multisig_configure, consume_approval,
    expire as multisig_expire, get_config as multisig_get_config, get_proposal,
    propose as multisig_propose, replace_config as multisig_replace_config, sign as multisig_sign,
    MultisigConfig, MultisigDataKey, Proposal, ProposalStatus, Signer, MAX_SIGNERS,
    PROPOSAL_TTL_SECS,
};
use reentrancy_guard::{acquire as acquire_reentrancy, release as release_reentrancy};
use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};
use storage::{DataKey, ScheduleEntry, StreamData, StreamDataV2, LEDGER_BUMP, LEDGER_THRESHOLD};

pub use storage::{ProposalAction as TreasuryProposalAction};

/// Cap the number of installments `preview_schedule` will return in a single
/// call to keep iteration costs bounded in a Soroban host invocation.
pub const MAX_INSTALLMENTS: u32 = 50;

/// Internal stream representation. Lets the rest of the contract operate on
/// legacy V1 and cliff-aware V2 records uniformly without leaking storage keys.
#[derive(Clone, Debug)]
pub(crate) enum StreamRecord {
    Legacy(StreamData),
    V2(StreamDataV2),
}

impl StreamRecord {
    fn total_amount(&self) -> i128 {
        match self {
            StreamRecord::Legacy(s) => s.total_amount,
            StreamRecord::V2(s) => s.total_amount,
        }
    }

    fn claimed_amount(&self) -> i128 {
        match self {
            StreamRecord::Legacy(s) => s.claimed_amount,
            StreamRecord::V2(s) => s.claimed_amount,
        }
    }

    fn start_time(&self) -> u64 {
        match self {
            StreamRecord::Legacy(s) => s.start_time,
            StreamRecord::V2(s) => s.start_time,
        }
    }

    fn duration(&self) -> u64 {
        match self {
            StreamRecord::Legacy(s) => s.duration,
            StreamRecord::V2(s) => s.duration,
        }
    }

    /// Returns 0 for legacy streams (no cliff), and the configured
    /// `cliff_time` for V2 streams.
    fn cliff_time(&self) -> u64 {
        match self {
            StreamRecord::Legacy(_) => 0,
            StreamRecord::V2(s) => s.cliff_time,
        }
    }

    fn add_claimed(&mut self, amount: i128) {
        match self {
            StreamRecord::Legacy(s) => s.claimed_amount += amount,
            StreamRecord::V2(s) => s.claimed_amount += amount,
        }
    }

    fn set_beneficiary(&mut self, addr: Address) {
        match self {
            StreamRecord::Legacy(s) => s.beneficiary = addr,
            StreamRecord::V2(s) => s.beneficiary = addr,
        }
    }

    /// Reset the stream to "all remaining amount, unvested" after a rotation.
    /// For V2 streams the cliff is preserved so the new beneficiary inherits
    /// the same vesting schedule.
    fn reset_remaining(&mut self, total: i128, start_time: u64, duration: u64) {
        match self {
            StreamRecord::Legacy(s) => {
                s.total_amount = total;
                s.claimed_amount = 0;
                s.start_time = start_time;
                s.duration = duration;
            }
            StreamRecord::V2(s) => {
                // Capture the original cliff offset BEFORE we overwrite
                // `s.start_time`, otherwise the offset is computed against
                // the new start_time (already mutated) and the cliff shifts
                // incorrectly.
                let old_offset = if s.cliff_time > 0 {
                    s.cliff_time.saturating_sub(s.start_time)
                } else {
                    0
                };
                s.total_amount = total;
                s.claimed_amount = 0;
                s.start_time = start_time;
                s.duration = duration;
                if s.cliff_time > 0 {
                    s.cliff_time = start_time.saturating_add(old_offset);
                }
            }
        }
    }
}

#[contract]
pub struct TreasuryContract;

#[contractimpl]
impl TreasuryContract {
    fn with_reentrancy_guard<T, F>(env: &Env, f: F) -> Result<T, TreasuryError>
    where
        F: FnOnce() -> Result<T, TreasuryError>,
    {
        acquire_reentrancy(env).map_err(|_| TreasuryError::Reentrancy)?;
        let result = f();
        release_reentrancy(env);
        result
    }

    /// Load a stream for `beneficiary`, preferring V2 (cliff-aware) storage.
    fn read_stream(env: &Env, beneficiary: &Address) -> Result<StreamRecord, TreasuryError> {
        let v2_key = DataKey::StreamV2(beneficiary.clone());
        if env.storage().persistent().has(&v2_key) {
            let v2: StreamDataV2 = env
                .storage()
                .persistent()
                .get(&v2_key)
                .expect("V2 stream marker present but value missing");
            return Ok(StreamRecord::V2(v2));
        }
        let v1_key = DataKey::Stream(beneficiary.clone());
        if env.storage().persistent().has(&v1_key) {
            let v1: StreamData = env
                .storage()
                .persistent()
                .get(&v1_key)
                .expect("V1 stream marker present but value missing");
            return Ok(StreamRecord::Legacy(v1));
        }
        Err(TreasuryError::StreamNotFound)
    }

    /// Persist a stream record to the correct storage key. Also bumps TTL.
    fn write_stream(env: &Env, stream: &StreamRecord) {
        match stream {
            StreamRecord::Legacy(s) => {
                let key = DataKey::Stream(s.beneficiary.clone());
                env.storage().persistent().set(&key, s);
                env.storage()
                    .persistent()
                    .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
            }
            StreamRecord::V2(s) => {
                let key = DataKey::StreamV2(s.beneficiary.clone());
                env.storage().persistent().set(&key, s);
                env.storage()
                    .persistent()
                    .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
            }
        }
    }

    /// Drop both V1 and V2 storage entries for `beneficiary`. Other variants
    /// remain untouched; only the per-beneficiary stream rows are cleared.
    fn delete_stream(env: &Env, beneficiary: &Address) {
        env.storage()
            .persistent()
            .remove(&DataKey::Stream(beneficiary.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::StreamV2(beneficiary.clone()));
    }

    /// Linear unlock curve for legacy `StreamData`.
    ///
    /// Uses `saturating_add` for the end-of-stream check to remain consistent
    /// with `cumulative_unlocked_at` and V2 unlock math.
    fn calculate_unlocked(current_time: u64, stream: &StreamData) -> i128 {
        if current_time < stream.start_time {
            0
        } else if current_time >= stream.start_time.saturating_add(stream.duration) {
            stream.total_amount - stream.claimed_amount
        } else {
            let time_elapsed = current_time - stream.start_time;
            let total_unlocked = (stream.total_amount as u128)
                .checked_mul(time_elapsed as u128)
                .and_then(|x| x.checked_div(stream.duration as u128))
                .unwrap_or(0) as i128;
            total_unlocked - stream.claimed_amount
        }
    }

    /// Linear unlock curve for `StreamDataV2`, with an optional cliff lockout.
    ///
    /// Semantics:
    /// - `cliff_time == 0` behaves identically to the legacy formula.
    /// - Before `cliff_time` (and after `start_time`) nothing unlocks.
    /// - At/after `cliff_time`, the linearly-vested amount (counting from
    ///   `start_time`) becomes claimable in one go and continues streaming.
    fn calculate_unlocked_v2(current_time: u64, stream: &StreamDataV2) -> i128 {
        if current_time < stream.start_time {
            return 0;
        }
        if stream.cliff_time > 0 && current_time < stream.cliff_time {
            return 0;
        }
        if current_time >= stream.start_time.saturating_add(stream.duration) {
            return stream.total_amount - stream.claimed_amount;
        }
        let time_elapsed = current_time - stream.start_time;
        let total_unlocked = (stream.total_amount as u128)
            .checked_mul(time_elapsed as u128)
            .and_then(|x| x.checked_div(stream.duration as u128))
            .unwrap_or(0) as i128;
        total_unlocked - stream.claimed_amount
    }

    /// Cumulative unlocked amount *gross* of any prior claims, for preview
    /// views. Differs from `calculate_unlocked*` which returns the
    /// currently-claimable remainder.
    fn cumulative_unlocked_at(time: u64, stream: &StreamRecord) -> i128 {
        let start_time = stream.start_time();
        let duration = stream.duration();
        let total_amount = stream.total_amount();
        let cliff_time = stream.cliff_time();

        if time < start_time {
            return 0;
        }
        if cliff_time > 0 && time < cliff_time {
            return 0;
        }
        let end_time = start_time.saturating_add(duration);
        if time >= end_time {
            return total_amount;
        }
        let elapsed = time - start_time;
        ((total_amount as u128)
            .checked_mul(elapsed as u128)
            .and_then(|x| x.checked_div(duration as u128))
            .unwrap_or(0)) as i128
    }

    fn calculate_unlocked_for(time: u64, stream: &StreamRecord) -> i128 {
        match stream {
            StreamRecord::Legacy(s) => Self::calculate_unlocked(time, s),
            StreamRecord::V2(s) => Self::calculate_unlocked_v2(time, s),
        }
    }

    /// Initialize the treasury with admin and token
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), TreasuryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(TreasuryError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        Ok(())
    }

    /// Configure the multisig signer set. The first signer is the bootstrapper
    /// and must authenticate the call. Call once after `initialize`.
    pub fn configure_multisig(
        env: Env,
        signers: Vec<Signer>,
        threshold: u32,
    ) -> Result<(), TreasuryError> {
        multisig_configure(&env, signers.clone(), threshold).map_err(|_| TreasuryError::InvalidMultisigConfig)?;
        let signer_count = signers.len();
        let bootstrapper = signers.get(0).ok_or(TreasuryError::InvalidMultisigConfig)?;
        events::publish_multisig_configured(
            &env,
            bootstrapper.address.clone(),
            threshold,
            signer_count,
        );
        Ok(())
    }

    // ── Multisig proposal lifecycle ──────────────────────────

    pub fn propose(
        env: Env,
        proposer: Address,
        action: ProposalAction,
    ) -> Result<u64, TreasuryError> {
        let payload = vec![&env, action.into_val(&env)];
        multisig_propose(&env, proposer, payload).map_err(|_| TreasuryError::Unauthorized)
    }

    pub fn sign_proposal(env: Env, signer: Address, proposal_id: u64) -> Result<(), TreasuryError> {
        multisig_sign(&env, signer, proposal_id).map_err(|_| TreasuryError::Unauthorized)?;
        Ok(())
    }

    pub fn cancel_proposal(
        env: Env,
        signer: Address,
        proposal_id: u64,
    ) -> Result<(), TreasuryError> {
        multisig_cancel(&env, signer, proposal_id).map_err(|_| TreasuryError::Unauthorized)
    }

    pub fn expire_proposal(env: Env, proposal_id: u64) -> Result<(), TreasuryError> {
        multisig_expire(&env, proposal_id).map_err(|_| TreasuryError::ProposalNotActive)
    }

    pub fn get_multisig_config(env: Env) -> Result<MultisigConfig, TreasuryError> {
        multisig_get_config(&env).map_err(|_| TreasuryError::NotInitialized)
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, TreasuryError> {
        get_proposal(&env, proposal_id).map_err(|_| TreasuryError::ProposalNotFound)
    }

    pub fn get_next_proposal_id(env: Env) -> u64 {
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.storage()
            .instance()
            .get(&MultisigDataKey::NextProposalId)
            .unwrap_or(0)
    }

    /// Allocate a budget and start a linear (legacy) stream.
    pub fn allocate_budget(
        env: Env,
        admin: Address,
        beneficiary: Address,
        amount: i128,
        start_time: u64,
        duration: u64,
        request_id: soroban_sdk::BytesN<32>,
    ) -> Result<(), TreasuryError> {
        Self::with_reentrancy_guard(&env, || {
            if idempotency_guard::claim_request(&env, &request_id).is_err() {
                return Err(TreasuryError::AlreadyExecuted);
            }

            let stored_admin: Address = env
                .storage()
                .instance()
                .get(&DataKey::Admin)
                .ok_or(TreasuryError::NotInitialized)?;

            if admin != stored_admin {
                return Err(TreasuryError::Unauthorized);
            }
            admin.require_auth();

            if amount <= 0 {
                return Err(TreasuryError::InvalidAmount);
            }
            if duration == 0 {
                return Err(TreasuryError::InvalidDuration);
            }

            let token_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token)
                .ok_or(TreasuryError::NotInitialized)?;

            // If a V2 cliff stream previously existed for this beneficiary,
            // drop its storage row so the new V1 allocation is the active
            // one (preserves the legacy "latest allocation wins" semantic).
            env.storage()
                .persistent()
                .remove(&DataKey::StreamV2(beneficiary.clone()));

            let stream = StreamData {
                beneficiary: beneficiary.clone(),
                total_amount: amount,
                claimed_amount: 0,
                start_time,
                duration,
            };

            env.storage()
                .persistent()
                .set(&DataKey::Stream(beneficiary.clone()), &stream);
            env.storage().persistent().extend_ttl(
                &DataKey::Stream(beneficiary.clone()),
                LEDGER_THRESHOLD,
                LEDGER_BUMP,
            );

            let token_client = token::TokenClient::new(&env, &token_addr);
            token_client.transfer(&admin, env.current_contract_address(), &amount);

            events::publish_stream_created(&env, beneficiary, amount, start_time, duration);

            Ok(())
        })
    }

    /// Allocate a budget and start a stream with an optional cliff lockout.
    ///
    /// `cliff_time`:
    /// - `0`: no cliff (equivalent to `allocate_budget`).
    /// - `> 0`: must satisfy `start_time <= cliff_time <= start_time + duration`.
    ///   Before `cliff_time`, nothing unlocks; at `cliff_time`, the linearly
    ///   vested amount becomes claimable in one go.
    #[allow(clippy::too_many_arguments)]
    pub fn allocate_budget_with_cliff(
        env: Env,
        admin: Address,
        beneficiary: Address,
        amount: i128,
        start_time: u64,
        duration: u64,
        cliff_time: u64,
        request_id: soroban_sdk::BytesN<32>,
    ) -> Result<(), TreasuryError> {
        Self::with_reentrancy_guard(&env, || {
            if idempotency_guard::claim_request(&env, &request_id).is_err() {
                return Err(TreasuryError::AlreadyExecuted);
            }

            let stored_admin: Address = env
                .storage()
                .instance()
                .get(&DataKey::Admin)
                .ok_or(TreasuryError::NotInitialized)?;

            if admin != stored_admin {
                return Err(TreasuryError::Unauthorized);
            }
            admin.require_auth();

            if amount <= 0 {
                return Err(TreasuryError::InvalidAmount);
            }
            if duration == 0 {
                return Err(TreasuryError::InvalidDuration);
            }

            // Cliff validation:
            //  - cliff_time == 0: no cliff, accepted.
            //  - cliff_time >  0: must lie within [start_time, start_time + duration].
            if cliff_time != 0 {
                if cliff_time < start_time {
                    return Err(TreasuryError::InvalidCliffTime);
                }
                let end_time = start_time
                    .checked_add(duration)
                    .ok_or(TreasuryError::InvalidCliffTime)?;
                if cliff_time > end_time {
                    return Err(TreasuryError::InvalidCliffTime);
                }
            }

            // If a legacy V1 stream previously existed for this
            // beneficiary, drop its storage row so the new V2 allocation
            // becomes the active one.
            env.storage()
                .persistent()
                .remove(&DataKey::Stream(beneficiary.clone()));

            let token_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token)
                .ok_or(TreasuryError::NotInitialized)?;

            let stream = StreamDataV2 {
                beneficiary: beneficiary.clone(),
                total_amount: amount,
                claimed_amount: 0,
                start_time,
                duration,
                cliff_time,
            };

            env.storage()
                .persistent()
                .set(&DataKey::StreamV2(beneficiary.clone()), &stream);
            env.storage().persistent().extend_ttl(
                &DataKey::StreamV2(beneficiary.clone()),
                LEDGER_THRESHOLD,
                LEDGER_BUMP,
            );

            let token_client = token::TokenClient::new(&env, &token_addr);
            token_client.transfer(&admin, env.current_contract_address(), &amount);

            events::publish_cliff_stream_created(
                &env,
                beneficiary,
                amount,
                start_time,
                duration,
                cliff_time,
            );

            Ok(())
        })
    }

    /// Claim unlocked funds (works against either V1 legacy or V2 cliff
    /// streams).
    pub fn claim(env: Env, beneficiary: Address) -> Result<i128, TreasuryError> {
        Self::with_reentrancy_guard(&env, || {
            beneficiary.require_auth();

            let mut stream = Self::read_stream(&env, &beneficiary)?;

            let current_time = env.ledger().timestamp();
            let unlocked = Self::calculate_unlocked_for(current_time, &stream);

            if unlocked <= 0 {
                return Err(TreasuryError::NothingToClaim);
            }

            stream.add_claimed(unlocked);
            let total = stream.total_amount();
            let claimed = stream.claimed_amount();
            let remaining = total - claimed;

            if remaining == 0 {
                Self::delete_stream(&env, &beneficiary);
            } else {
                Self::write_stream(&env, &stream);
            }

            let token_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token)
                .ok_or(TreasuryError::NotInitialized)?;

            let token_client = token::TokenClient::new(&env, &token_addr);
            token_client.transfer(&env.current_contract_address(), &beneficiary, &unlocked);

            events::publish_tokens_claimed(&env, beneficiary.clone(), unlocked, remaining);

            Ok(unlocked)
        })
    }

    /// Rotate beneficiary for a stream, preserving accrued claim state.
    ///
    /// Works against either V1 legacy or V2 cliff streams. For V2 streams the
    /// cliff is preserved (shifted relative to the new start_time) so the new
    /// beneficiary inherits the same effective vesting schedule.
    pub fn rotate_beneficiary(
        env: Env,
        admin: Address,
        old_beneficiary: Address,
        new_beneficiary: Address,
    ) -> Result<(), TreasuryError> {
        Self::with_reentrancy_guard(&env, || {
            let stored_admin: Address = env
                .storage()
                .instance()
                .get(&DataKey::Admin)
                .ok_or(TreasuryError::NotInitialized)?;

            if admin != stored_admin {
                return Err(TreasuryError::Unauthorized);
            }
            admin.require_auth();

            if old_beneficiary == new_beneficiary {
                return Err(TreasuryError::SameBeneficiary);
            }

            let mut stream = Self::read_stream(&env, &old_beneficiary)?;

            let claimed_amount = stream.claimed_amount();
            let total_amount = stream.total_amount();
            let remaining_amount = total_amount - claimed_amount;

            if claimed_amount == 0 {
                stream.set_beneficiary(new_beneficiary.clone());
            } else {
                // Restart clock for the remaining portion only.
                stream.reset_remaining(remaining_amount, env.ledger().timestamp(), 0);
                stream.set_beneficiary(new_beneficiary.clone());
            }

            let old_beneficiary_for_event = old_beneficiary.clone();
            Self::delete_stream(&env, &old_beneficiary);
            Self::write_stream(&env, &stream);

            events::publish_beneficiary_rotated(
                &env,
                old_beneficiary_for_event,
                new_beneficiary,
                claimed_amount,
                remaining_amount,
            );

            Ok(())
        })
    }

    /// Multisig-gated admin rotation.
    pub fn set_admin_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        new_admin: Address,
    ) -> Result<(), TreasuryError> {
        let expected_payload = vec![&env, ProposalAction::SetAdmin(new_admin.clone()).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| TreasuryError::Unauthorized)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    /// Multisig-gated beneficiary rotation.
    pub fn rotate_beneficiary_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        old_beneficiary: Address,
        new_beneficiary: Address,
    ) -> Result<(), TreasuryError> {
        Self::with_reentrancy_guard(&env, || {
            let expected_payload = vec![&env, ProposalAction::RotateBeneficiary(old_beneficiary.clone(), new_beneficiary.clone()).into_val(&env)];
            consume_approval(
                &env,
                &executor,
                proposal_id,
                &expected_payload,
            ).map_err(|_| TreasuryError::Unauthorized)?;

            if old_beneficiary == new_beneficiary {
                return Err(TreasuryError::SameBeneficiary);
            }

            let mut stream = Self::read_stream(&env, &old_beneficiary)?;

            let claimed_amount = stream.claimed_amount();
            let total_amount = stream.total_amount();
            let remaining_amount = total_amount - claimed_amount;

            if claimed_amount == 0 {
                stream.set_beneficiary(new_beneficiary.clone());
            } else {
                stream.reset_remaining(remaining_amount, env.ledger().timestamp(), 0);
                stream.set_beneficiary(new_beneficiary.clone());
            }

            let old_beneficiary_for_event = old_beneficiary.clone();
            Self::delete_stream(&env, &old_beneficiary);
            Self::write_stream(&env, &stream);

            events::publish_beneficiary_rotated(
                &env,
                old_beneficiary_for_event,
                new_beneficiary,
                claimed_amount,
                remaining_amount,
            );

            Ok(())
        })
    }

    /// Replace the multisig config (signers + threshold).
    pub fn set_multisig_config_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        signers: Vec<Signer>,
        threshold: u32,
    ) -> Result<(), TreasuryError> {
        let expected_payload = vec![&env, ProposalAction::SetMultisigConfig(signers.clone(), threshold).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| TreasuryError::Unauthorized)?;
        multisig_replace_config(&env, signers, threshold).map_err(|_| TreasuryError::InvalidMultisigConfig)
    }

    /// View currently unlocked amount (matches legacy V1 semantics; V2 with
    /// `cliff_time == 0` returns identical values, V2 with `cliff_time > 0`
    /// respects the lockout).
    pub fn get_unlocked(env: Env, beneficiary: Address) -> Result<i128, TreasuryError> {
        let stream = Self::read_stream(&env, &beneficiary)?;
        Ok(Self::calculate_unlocked_for(
            env.ledger().timestamp(),
            &stream,
        ))
    }

    /// Returns the cliff timestamp configured for this beneficiary's stream,
    /// or `0` if the stream has no cliff (or is a legacy V1 stream).
    pub fn get_cliff(env: Env, beneficiary: Address) -> Result<u64, TreasuryError> {
        let stream = Self::read_stream(&env, &beneficiary)?;
        Ok(stream.cliff_time())
    }

    pub fn get_admin(env: Env) -> Result<Address, TreasuryError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TreasuryError::NotInitialized)
    }

    pub fn get_token(env: Env) -> Result<Address, TreasuryError> {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(TreasuryError::NotInitialized)
    }

    // ============================================
    // CANCELLATION & RECOVERY FUNCTIONS
    // ============================================

    /// Cancel an active stream and return (total unlocked, refundable) amounts.
    /// `total_unlocked` includes any amount already claimed prior to cancellation.
    /// Works for both V1 legacy and V2 cliff streams; the cliff is respected
    /// when computing what has unlocked so far.
    pub fn cancel_stream(
        env: Env,
        admin: Address,
        beneficiary: Address,
    ) -> Result<(i128, i128), TreasuryError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TreasuryError::NotInitialized)?;

        if admin != stored_admin {
            return Err(TreasuryError::Unauthorized);
        }
        admin.require_auth();

        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(TreasuryError::NotInitialized)?;

        let token_client = token::TokenClient::new(&env, &token_address);
        let contract_address = env.current_contract_address();

        let stream = Self::read_stream(&env, &beneficiary)?;

        let current_time = env.ledger().timestamp();
        let newly_unlocked = Self::calculate_unlocked_for(current_time, &stream);
        let total_amount = stream.total_amount();
        let claimed_amount = stream.claimed_amount();
        let remaining = total_amount - claimed_amount;
        let refundable = remaining - newly_unlocked;
        let total_unlocked = claimed_amount + newly_unlocked;

        if refundable > 0 {
            token_client.transfer(&contract_address, &beneficiary, &refundable);
        }

        #[allow(deprecated)]
        env.events().publish(
            (soroban_sdk::String::from_str(&env, "stream_cancelled"),),
            (&beneficiary, total_unlocked, refundable, current_time),
        );

        Self::delete_stream(&env, &beneficiary);

        Ok((total_unlocked, refundable))
    }

    /// Emergency stop - refund full remaining amount regardless of vesting.
    pub fn emergency_stop(
        env: Env,
        admin: Address,
        beneficiary: Address,
        reason: soroban_sdk::String,
    ) -> Result<i128, TreasuryError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TreasuryError::NotInitialized)?;

        if admin != stored_admin {
            return Err(TreasuryError::Unauthorized);
        }
        admin.require_auth();

        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(TreasuryError::NotInitialized)?;

        let token_client = token::TokenClient::new(&env, &token_address);
        let contract_address = env.current_contract_address();

        let stream = Self::read_stream(&env, &beneficiary)?;

        let total_amount = stream.total_amount();
        let claimed_amount = stream.claimed_amount();
        let full_refund = total_amount - claimed_amount;

        if full_refund > 0 {
            token_client.transfer(&contract_address, &beneficiary, &full_refund);
        }

        #[allow(deprecated)]
        env.events().publish(
            (soroban_sdk::String::from_str(&env, "emergency_stop"),),
            (&beneficiary, reason, full_refund),
        );

        Self::delete_stream(&env, &beneficiary);

        Ok(full_refund)
    }

    // ============================================
    // PREVIEW / SCHEDULE QUERIES  (Issue #1050)
    // ============================================

    /// Returns the cumulative unlocked amount that would be claimable at
    /// `at_time`, gross of any prior claims. Useful for admin tools and UIs
    /// that want to display a "would be unlocked at" view into the future.
    ///
    /// Honors cliff semantics: returns 0 if `at_time` is on or before the
    /// stream's cliff timestamp (when cliff is configured).
    pub fn preview_unlocked_at(
        env: Env,
        beneficiary: Address,
        at_time: u64,
    ) -> Result<i128, TreasuryError> {
        let stream = Self::read_stream(&env, &beneficiary)?;
        Ok(Self::cumulative_unlocked_at(at_time, &stream))
    }

    /// Project an installment schedule of (timestamp, cumulative_unlocked)
    /// pairs starting from the current ledger time, stepping by
    /// `step_interval` seconds for `num_steps` entries.
    ///
    /// Cap: `num_steps <= MAX_INSTALLMENTS` and `step_interval > 0` are
    /// enforced to bound host compute.
    pub fn preview_schedule(
        env: Env,
        beneficiary: Address,
        step_interval: u64,
        num_steps: u32,
    ) -> Result<Vec<ScheduleEntry>, TreasuryError> {
        if step_interval == 0 {
            return Err(TreasuryError::InvalidScheduleStep);
        }
        if num_steps == 0 {
            return Err(TreasuryError::InvalidScheduleStep);
        }
        if num_steps > MAX_INSTALLMENTS {
            return Err(TreasuryError::TooManyInstallments);
        }

        let stream = Self::read_stream(&env, &beneficiary)?;
        let start = env.ledger().timestamp();

        let mut entries: Vec<ScheduleEntry> = Vec::new(&env);
        for i in 0..num_steps {
            let offset = step_interval
                .checked_mul(i as u64)
                .ok_or(TreasuryError::InvalidScheduleStep)?;
            let at = start
                .checked_add(offset)
                .ok_or(TreasuryError::InvalidScheduleStep)?;
            let cumulative = Self::cumulative_unlocked_at(at, &stream);
            entries.push_back(ScheduleEntry {
                at,
                cumulative_unlocked: cumulative,
            });
        }
        Ok(entries)
    }
}

#[cfg(test)]
mod test;
