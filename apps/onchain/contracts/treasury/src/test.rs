use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token, vec, Address, BytesN, Env};

fn request_id(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0; 32])
}

// ── Test fixtures ────────────────────────────────────────────

struct MultisigFixture<'a> {
    env: Env,
    client: TreasuryContractClient<'a>,
    signer_a: Address,
    signer_b: Address,
    #[allow(dead_code)]
    signer_c: Address,
    outsider: Address,
    admin: Address,
    beneficiary: Address,
    new_admin: Address,
    new_beneficiary: Address,
    #[allow(dead_code)]
    _token_admin: Address,
}

impl<'a> MultisigFixture<'a> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let stellar_client = token::StellarAssetClient::new(&env, &token_id.address());

        let contract_id = env.register(TreasuryContract, ());
        let client = TreasuryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        client.initialize(&admin, &token_id.address());

        let signer_a = Address::generate(&env);
        let signer_b = Address::generate(&env);
        let signer_c = Address::generate(&env);
        let outsider = Address::generate(&env);
        let new_admin = Address::generate(&env);
        let new_beneficiary = Address::generate(&env);

        // 3 signers, weight 1 each, threshold = 2.
        let signers: Vec<Signer> = vec![
            &env,
            Signer {
                address: signer_a.clone(),
                weight: 1,
            },
            Signer {
                address: signer_b.clone(),
                weight: 1,
            },
            Signer {
                address: signer_c.clone(),
                weight: 1,
            },
        ];
        client.configure_multisig(&signers, &2);

        // Pre-create a stream for beneficiary-rotation tests.
        stellar_client.mint(&admin, &1000);
        env.ledger().set_timestamp(1000);
        client.allocate_budget(&admin, &beneficiary, &1000, &1000, &1000, &request_id(&env));

        MultisigFixture {
            env,
            client,
            signer_a,
            signer_b,
            signer_c,
            outsider,
            admin,
            beneficiary,
            new_admin,
            new_beneficiary,
            _token_admin: token_admin,
        }
    }
}

#[test]
fn test_treasury_streaming() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let token_admin = Address::generate(&env);

    // Deploy token
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_client = token::TokenClient::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    // Deploy treasury
    let treasury_id = env.register(TreasuryContract, ());
    let treasury_client = TreasuryContractClient::new(&env, &treasury_id);

    // Initialize
    treasury_client.initialize(&admin, &token_id.address());

    // Mint tokens to admin
    let amount = 1000i128;
    token_admin_client.mint(&admin, &amount);

    // Allocate budget
    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    treasury_client.allocate_budget(
        &admin,
        &beneficiary,
        &amount,
        &start_time,
        &duration,
        &request_id(&env),
    );

    // Check unlocked at start_time (should be 0)
    assert_eq!(treasury_client.get_unlocked(&beneficiary), 0);

    // Move time forward by 500 seconds (half duration)
    env.ledger().set_timestamp(start_time + 500);
    assert_eq!(treasury_client.get_unlocked(&beneficiary), 500);

    // Claim half
    let claimed = treasury_client.claim(&beneficiary);
    assert_eq!(claimed, 500);
    assert_eq!(token_client.balance(&beneficiary), 500);

    // Check unlocked again (should be 0 now since we just claimed)
    assert_eq!(treasury_client.get_unlocked(&beneficiary), 0);

    // Move time forward to end
    env.ledger().set_timestamp(start_time + 1000);
    assert_eq!(treasury_client.get_unlocked(&beneficiary), 500);

    // Claim rest
    treasury_client.claim(&beneficiary);
    assert_eq!(token_client.balance(&beneficiary), 1000);
}

#[test]
fn test_allocate_budget_duplicate_request_id() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let token_admin = Address::generate(&env);

    // Deploy token
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    // Deploy treasury
    let treasury_id = env.register(TreasuryContract, ());
    let treasury_client = TreasuryContractClient::new(&env, &treasury_id);

    // Initialize
    treasury_client.initialize(&admin, &token_id.address());

    // Mint tokens to admin
    let amount = 1000i128;
    token_admin_client.mint(&admin, &amount);

    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    // First allocation should succeed
    treasury_client.allocate_budget(
        &admin,
        &beneficiary,
        &amount,
        &start_time,
        &duration,
        &request_id(&env),
    );

    // Second allocation with same request_id should fail
    let result = treasury_client.try_allocate_budget(
        &admin,
        &beneficiary,
        &amount,
        &start_time,
        &duration,
        &request_id(&env),
    );
    assert_eq!(result, Err(Ok(TreasuryError::AlreadyExecuted)));
}

#[test]
fn test_rotate_beneficiary_before_claims() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let old_beneficiary = Address::generate(&env);
    let new_beneficiary = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_client = token::TokenClient::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let treasury_id = env.register(TreasuryContract, ());
    let treasury_client = TreasuryContractClient::new(&env, &treasury_id);

    treasury_client.initialize(&admin, &token_id.address());

    let amount = 1000i128;
    token_admin_client.mint(&admin, &amount);

    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    treasury_client.allocate_budget(
        &admin,
        &old_beneficiary,
        &amount,
        &start_time,
        &duration,
        &request_id(&env),
    );

    env.ledger().set_timestamp(start_time + 500);

    treasury_client.rotate_beneficiary(&admin, &old_beneficiary, &new_beneficiary);

    assert_eq!(
        treasury_client.try_get_unlocked(&old_beneficiary),
        Err(Ok(TreasuryError::StreamNotFound))
    );

    assert_eq!(treasury_client.get_unlocked(&new_beneficiary), 500);

    env.ledger().set_timestamp(start_time + 1000);
    assert_eq!(treasury_client.get_unlocked(&new_beneficiary), 1000);

    let claimed = treasury_client.claim(&new_beneficiary);
    assert_eq!(claimed, 1000);
    assert_eq!(token_client.balance(&new_beneficiary), 1000);
}

#[test]
fn test_rotate_beneficiary_after_partial_claims() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let old_beneficiary = Address::generate(&env);
    let new_beneficiary = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_client = token::TokenClient::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let treasury_id = env.register(TreasuryContract, ());
    let treasury_client = TreasuryContractClient::new(&env, &treasury_id);

    treasury_client.initialize(&admin, &token_id.address());

    let amount = 1000i128;
    token_admin_client.mint(&admin, &amount);

    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    treasury_client.allocate_budget(
        &admin,
        &old_beneficiary,
        &amount,
        &start_time,
        &duration,
        &request_id(&env),
    );

    env.ledger().set_timestamp(start_time + 500);

    let claimed = treasury_client.claim(&old_beneficiary);
    assert_eq!(claimed, 500);
    assert_eq!(token_client.balance(&old_beneficiary), 500);

    treasury_client.rotate_beneficiary(&admin, &old_beneficiary, &new_beneficiary);

    assert_eq!(
        treasury_client.try_get_unlocked(&old_beneficiary),
        Err(Ok(TreasuryError::StreamNotFound))
    );

    assert_eq!(treasury_client.get_unlocked(&new_beneficiary), 500);

    env.ledger().set_timestamp(start_time + 1000);
    assert_eq!(treasury_client.get_unlocked(&new_beneficiary), 500);

    let claimed_remaining = treasury_client.claim(&new_beneficiary);
    assert_eq!(claimed_remaining, 500);
    assert_eq!(token_client.balance(&new_beneficiary), 500);

    assert_eq!(token_client.balance(&old_beneficiary), 500);
    assert_eq!(token_client.balance(&new_beneficiary), 500);
}

#[test]
fn test_rotate_beneficiary_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let new_beneficiary = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let treasury_id = env.register(TreasuryContract, ());
    let treasury_client = TreasuryContractClient::new(&env, &treasury_id);

    treasury_client.initialize(&admin, &token_id.address());

    let amount = 1000i128;
    token_admin_client.mint(&admin, &amount);

    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    treasury_client.allocate_budget(
        &admin,
        &beneficiary,
        &amount,
        &start_time,
        &duration,
        &request_id(&env),
    );

    assert_eq!(
        treasury_client.try_rotate_beneficiary(&unauthorized, &beneficiary, &new_beneficiary),
        Err(Ok(TreasuryError::Unauthorized))
    );
}

#[test]
fn test_rotate_beneficiary_same_address() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let treasury_id = env.register(TreasuryContract, ());
    let treasury_client = TreasuryContractClient::new(&env, &treasury_id);

    treasury_client.initialize(&admin, &token_id.address());

    let amount = 1000i128;
    token_admin_client.mint(&admin, &amount);

    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    treasury_client.allocate_budget(
        &admin,
        &beneficiary,
        &amount,
        &start_time,
        &duration,
        &request_id(&env),
    );

    assert_eq!(
        treasury_client.try_rotate_beneficiary(&admin, &beneficiary, &beneficiary),
        Err(Ok(TreasuryError::SameBeneficiary))
    );
}

#[test]
fn test_rotate_beneficiary_stream_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let old_beneficiary = Address::generate(&env);
    let new_beneficiary = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let treasury_id = env.register(TreasuryContract, ());
    let treasury_client = TreasuryContractClient::new(&env, &treasury_id);

    treasury_client.initialize(&admin, &token_id.address());

    assert_eq!(
        treasury_client.try_rotate_beneficiary(&admin, &old_beneficiary, &new_beneficiary),
        Err(Ok(TreasuryError::StreamNotFound))
    );
}

// ── Issue #864: Multisig propose/execute lifecycle tests ─────────

/// `set_admin_via_multisig` is gated: an outsider cannot execute it.
#[test]
fn test_set_admin_via_multisig_rejects_outsider() {
    let f = MultisigFixture::new();
    assert_eq!(
        f.client
            .try_set_admin_via_multisig(&f.outsider, &0u64, &f.new_admin,),
        Err(Ok(TreasuryError::Unauthorized))
    );
}

/// A proposal must reach threshold before execution is allowed.
#[test]
fn test_set_admin_via_multisig_requires_approval() {
    let f = MultisigFixture::new();

    // Only one signer has voted — still Pending.
    let pid = f.client.propose(&f.signer_a, &ProposalAction::SetAdmin);
    assert_eq!(f.client.get_proposal(&pid).status, ProposalStatus::Pending);

    // Executing a Pending proposal must fail.
    assert_eq!(
        f.client
            .try_set_admin_via_multisig(&f.signer_a, &pid, &f.new_admin),
        Err(Ok(TreasuryError::ProposalNotApproved))
    );

    // Admin must not have changed.
    assert_eq!(f.client.get_admin(), f.admin);
}

/// A non-existent proposal cannot be consumed.
#[test]
fn test_set_admin_via_multisig_unknown_proposal() {
    let f = MultisigFixture::new();
    assert_eq!(
        f.client
            .try_set_admin_via_multisig(&f.signer_a, &999u64, &f.new_admin),
        Err(Ok(TreasuryError::ProposalNotFound))
    );
}

/// Happy path: 2-of-3 multisig approves a `SetAdmin` proposal and the new
/// admin takes effect. Admin change is auditable via `ProposalExecutedEvent`.
#[test]
fn test_set_admin_via_multisig_succeeds_with_approval() {
    let f = MultisigFixture::new();

    let pid = f.client.propose(&f.signer_a, &ProposalAction::SetAdmin);
    assert_eq!(f.client.get_proposal(&pid).status, ProposalStatus::Pending);
    f.client.sign_proposal(&f.signer_b, &pid);
    assert_eq!(f.client.get_proposal(&pid).status, ProposalStatus::Approved);

    f.client
        .set_admin_via_multisig(&f.signer_a, &pid, &f.new_admin);

    assert_eq!(f.client.get_admin(), f.new_admin);
    assert_eq!(f.client.get_proposal(&pid).status, ProposalStatus::Executed);

    // Replay must fail.
    assert!(f
        .client
        .try_set_admin_via_multisig(&f.signer_a, &pid, &f.admin)
        .is_err());
}

/// An approved proposal must be consumed with the matching action type.
#[test]
fn test_set_admin_via_multisig_wrong_action_rejected() {
    let f = MultisigFixture::new();

    let pid = f
        .client
        .propose(&f.signer_a, &ProposalAction::RotateBeneficiary);
    f.client.sign_proposal(&f.signer_b, &pid);

    // SetAdmin entry point must not consume a RotateBeneficiary proposal.
    assert_eq!(
        f.client
            .try_set_admin_via_multisig(&f.signer_a, &pid, &f.new_admin),
        Err(Ok(TreasuryError::WrongProposalAction))
    );
}

/// An expired proposal cannot be used to execute the action.
#[test]
fn test_set_admin_via_multisig_expired_proposal_rejected() {
    let f = MultisigFixture::new();

    let pid = f.client.propose(&f.signer_a, &ProposalAction::SetAdmin);
    f.client.sign_proposal(&f.signer_b, &pid);
    assert_eq!(f.client.get_proposal(&pid).status, ProposalStatus::Approved);

    // Advance past the proposal TTL.
    f.env.ledger().set_timestamp(2_000 + PROPOSAL_TTL_SECS + 1);
    f.client.expire_proposal(&pid);
    assert_eq!(f.client.get_proposal(&pid).status, ProposalStatus::Expired);

    // Status is now Expired — any gated entry point must reject.
    assert_eq!(
        f.client
            .try_set_admin_via_multisig(&f.signer_a, &pid, &f.new_admin),
        Err(Ok(TreasuryError::ProposalNotActive))
    );
}

/// Cancelled proposals are unusable.
#[test]
fn test_set_admin_via_multisig_cancelled_proposal_rejected() {
    let f = MultisigFixture::new();

    let pid = f.client.propose(&f.signer_a, &ProposalAction::SetAdmin);
    f.client.sign_proposal(&f.signer_b, &pid);
    f.client.cancel_proposal(&f.signer_a, &pid);
    assert_eq!(
        f.client.get_proposal(&pid).status,
        ProposalStatus::Cancelled
    );

    assert_eq!(
        f.client
            .try_set_admin_via_multisig(&f.signer_a, &pid, &f.new_admin),
        Err(Ok(TreasuryError::ProposalNotActive))
    );
}

/// `rotate_beneficiary_via_multisig` is gated by an approved proposal and
/// preserves the existing claim/vesting semantics.
#[test]
fn test_rotate_beneficiary_via_multisig_succeeds() {
    let f = MultisigFixture::new();

    let pid = f
        .client
        .propose(&f.signer_a, &ProposalAction::RotateBeneficiary);
    f.client.sign_proposal(&f.signer_b, &pid);

    f.env.ledger().set_timestamp(1500);
    f.client
        .rotate_beneficiary_via_multisig(&f.signer_a, &pid, &f.beneficiary, &f.new_beneficiary);

    // Old stream gone, new stream holds the (still-unlocked) remaining amount.
    assert_eq!(
        f.client.try_get_unlocked(&f.beneficiary),
        Err(Ok(TreasuryError::StreamNotFound))
    );
    assert_eq!(f.client.get_unlocked(&f.new_beneficiary), 500);
    assert_eq!(f.client.get_proposal(&pid).status, ProposalStatus::Executed);

    // Replay is rejected.
    assert!(f
        .client
        .try_rotate_beneficiary_via_multisig(&f.signer_a, &pid, &f.new_beneficiary, &f.beneficiary,)
        .is_err());
}

/// Outsider cannot rotate a beneficiary even with a real proposal id.
#[test]
fn test_rotate_beneficiary_via_multisig_rejects_outsider() {
    let f = MultisigFixture::new();

    let pid = f
        .client
        .propose(&f.signer_a, &ProposalAction::RotateBeneficiary);
    f.client.sign_proposal(&f.signer_b, &pid);

    assert_eq!(
        f.client.try_rotate_beneficiary_via_multisig(
            &f.outsider,
            &pid,
            &f.beneficiary,
            &f.new_beneficiary,
        ),
        Err(Ok(TreasuryError::Unauthorized))
    );
}

/// An outsider cannot even create a proposal.
#[test]
fn test_propose_rejects_outsider() {
    let f = MultisigFixture::new();
    assert_eq!(
        f.client.try_propose(&f.outsider, &ProposalAction::SetAdmin),
        Err(Ok(TreasuryError::Unauthorized))
    );
}

/// Double-signing a proposal is rejected.
#[test]
fn test_double_sign_rejected() {
    let f = MultisigFixture::new();
    let pid = f.client.propose(&f.signer_a, &ProposalAction::SetAdmin);
    assert_eq!(
        f.client.try_sign_proposal(&f.signer_a, &pid),
        Err(Ok(TreasuryError::ProposalAlreadySigned))
    );
}

/// Cancelling an in-flight proposal changes its status.
#[test]
fn test_cancel_proposal_changes_status() {
    let f = MultisigFixture::new();
    let pid = f.client.propose(&f.signer_a, &ProposalAction::SetAdmin);
    assert_eq!(f.client.get_proposal(&pid).status, ProposalStatus::Pending);
    f.client.cancel_proposal(&f.signer_a, &pid);
    assert_eq!(
        f.client.get_proposal(&pid).status,
        ProposalStatus::Cancelled
    );
}

/// Threshold of 1 means a single signer with weight ≥ 1 auto-approves on propose.
#[test]
fn test_threshold_one_auto_approves_on_propose() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let contract_id = env.register(TreasuryContract, ());
    let client = TreasuryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &token_id.address());

    let signer = Address::generate(&env);
    let signers = vec![
        &env,
        Signer {
            address: signer.clone(),
            weight: 1,
        },
    ];
    client.configure_multisig(&signers, &1);

    let pid = client.propose(&signer, &ProposalAction::SetAdmin);
    assert_eq!(client.get_proposal(&pid).status, ProposalStatus::Approved);
}

/// Single-signer threshold lets a single signer rotate the admin immediately.
#[test]
fn test_set_multisig_config_succeeds_via_self_consume() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let contract_id = env.register(TreasuryContract, ());
    let client = TreasuryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &token_id.address());

    let old_signer = Address::generate(&env);
    let signers = vec![
        &env,
        Signer {
            address: old_signer.clone(),
            weight: 1,
        },
    ];
    client.configure_multisig(&signers, &1);

    let new_signer = Address::generate(&env);
    let new_signers = vec![
        &env,
        Signer {
            address: new_signer.clone(),
            weight: 1,
        },
    ];

    let pid = client.propose(&old_signer, &ProposalAction::SetAdmin);
    assert_eq!(client.get_proposal(&pid).status, ProposalStatus::Approved);
    client.set_multisig_config(&old_signer, &pid, &new_signers, &1);

    let cfg = client.get_multisig_config();
    assert_eq!(cfg.signers.get(0).unwrap().address, new_signer);
}

/// Invalid multisig configs (empty, threshold 0, threshold > total weight) are rejected.
#[test]
fn test_configure_multisig_validates_input() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let contract_id = env.register(TreasuryContract, ());
    let client = TreasuryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &token_id.address());

    // Empty signer set
    let empty: Vec<Signer> = vec![&env];
    assert_eq!(
        client.try_configure_multisig(&empty, &1),
        Err(Ok(TreasuryError::InvalidMultisigConfig))
    );

    // Threshold > total weight
    let a = Address::generate(&env);
    let signers = vec![
        &env,
        Signer {
            address: a.clone(),
            weight: 1,
        },
    ];
    assert_eq!(
        client.try_configure_multisig(&signers, &2),
        Err(Ok(TreasuryError::InvalidMultisigConfig))
    );
}

/// Proposal ids increment monotonically across multiple proposals.
#[test]
fn test_proposal_ids_are_monotonic() {
    let f = MultisigFixture::new();
    let id1 = f.client.propose(&f.signer_a, &ProposalAction::SetAdmin);
    let id2 = f
        .client
        .propose(&f.signer_a, &ProposalAction::RotateBeneficiary);
    let id3 = f.client.propose(&f.signer_a, &ProposalAction::SetAdmin);
    assert_eq!(id1, 0);
    assert_eq!(id2, 1);
    assert_eq!(id3, 2);
    assert_eq!(f.client.get_next_proposal_id(), 3);
}
