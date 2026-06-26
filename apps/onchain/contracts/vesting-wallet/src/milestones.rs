use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::errors::VestingError;
use crate::storage::DataKey;

/// A milestone that can unlock a portion of vested tokens early.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Milestone {
    /// Human-readable label stored on-chain for auditability.
    pub label: soroban_sdk::String,
    /// Fraction of total_amount unlocked when this milestone is reached, in basis points (0–10000).
    pub unlock_bps: u32,
    /// Whether an admin has marked this milestone as achieved.
    pub achieved: bool,
}

/// Storage key for the milestone list associated with a beneficiary.
#[contracttype]
pub enum MilestoneKey {
    Milestones(Address),
}

/// Returns how many extra tokens are unlocked for `beneficiary` due to achieved milestones.
///
/// The returned value is added on top of the time-based claimable amount in the main contract.
pub fn milestone_unlocked_amount(env: &Env, beneficiary: &Address, total_amount: i128) -> i128 {
    let key = MilestoneKey::Milestones(beneficiary.clone());
    let milestones: Vec<Milestone> = match env.storage().persistent().get(&key) {
        Some(v) => v,
        None => return 0,
    };

    let mut total_bps: u32 = 0;
    for m in milestones.iter() {
        if m.achieved {
            total_bps = total_bps.saturating_add(m.unlock_bps);
        }
    }
    // Cap at 100 % (10 000 bps).
    let effective_bps = total_bps.min(10_000) as i128;
    (total_amount * effective_bps) / 10_000
}

/// Admin-only: register milestones for `beneficiary`.
///
/// Replaces any existing milestone list.
pub fn set_milestones(
    env: &Env,
    admin: &Address,
    beneficiary: &Address,
    milestones: Vec<Milestone>,
) -> Result<(), VestingError> {
    let stored_admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(VestingError::NotInitialized)?;
    if admin != &stored_admin {
        return Err(VestingError::Unauthorized);
    }
    admin.require_auth();

    let key = MilestoneKey::Milestones(beneficiary.clone());
    env.storage().persistent().set(&key, &milestones);
    Ok(())
}

/// Admin-only: mark the milestone at `index` as achieved for `beneficiary`.
pub fn achieve_milestone(
    env: &Env,
    admin: &Address,
    beneficiary: &Address,
    index: u32,
) -> Result<(), VestingError> {
    let stored_admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(VestingError::NotInitialized)?;
    if admin != &stored_admin {
        return Err(VestingError::Unauthorized);
    }
    admin.require_auth();

    let key = MilestoneKey::Milestones(beneficiary.clone());
    let mut milestones: Vec<Milestone> = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(VestingError::NotInitialized)?;

    if index as usize >= milestones.len() as usize {
        return Err(VestingError::InvalidAmount);
    }

    let mut m = milestones.get(index).unwrap();
    m.achieved = true;
    milestones.set(index, m);
    env.storage().persistent().set(&key, &milestones);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, Env, String};

    #[test]
    fn no_milestones_returns_zero() {
        let env = Env::default();
        let beneficiary = Address::generate(&env);
        assert_eq!(milestone_unlocked_amount(&env, &beneficiary, 1_000), 0);
    }

    #[test]
    fn achieved_milestone_unlocks_correct_fraction() {
        let env = Env::default();
        let beneficiary = Address::generate(&env);

        let ms = vec![
            &env,
            Milestone {
                label: String::from_str(&env, "beta_launch"),
                unlock_bps: 2_500, // 25 %
                achieved: true,
            },
        ];

        let key = MilestoneKey::Milestones(beneficiary.clone());
        env.storage().persistent().set(&key, &ms);

        assert_eq!(milestone_unlocked_amount(&env, &beneficiary, 10_000), 2_500);
    }
}
