use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token, vec, Address, BytesN, Env, String};

fn request_id(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0; 32])
}

fn fresh_request_id(env: &Env, nonce: u8) -> BytesN<32> {
    let mut buf = [0u8; 32];
    buf[31] = nonce;
    BytesN::from_array(env, &buf)
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

// ── Cancellation & emergency recovery tests ──────────────────

#[test]
fn test_cancel_stream_partial_claim() {
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

    env.ledger().set_timestamp(start_time + 500);

    let claimed = treasury_client.claim(&beneficiary);
    assert_eq!(claimed, 500);

    let (claimed_total, refunded) = treasury_client.cancel_stream(&admin, &beneficiary);
    assert_eq!(claimed_total, 500);
    assert_eq!(refunded, 500);
}

#[test]
fn test_cancel_stream_immediate() {
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

    let (claimed, refunded) = treasury_client.cancel_stream(&admin, &beneficiary);
    assert_eq!(claimed, 0);
    assert_eq!(refunded, 1000);
}

#[test]
fn test_emergency_stop_full_refund() {
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

    env.ledger().set_timestamp(start_time + 500);

    let refunded = treasury_client.emergency_stop(
        &admin,
        &beneficiary,
        &String::from_str(&env, "Security breach"),
    );

    assert_eq!(refunded, 1000);
}

#[test]
fn test_cancel_nonexistent_stream() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let treasury_id = env.register(TreasuryContract, ());
    let treasury_client = TreasuryContractClient::new(&env, &treasury_id);

    treasury_client.initialize(&admin, &token_id.address());

    let result = treasury_client.try_cancel_stream(&admin, &beneficiary);
    assert!(result.is_err());
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

// ── Issue #1050: Cliff + preview tests ───────────────────────────────

fn make_env_with_token() -> (
    Env,
    Address,
    Address,
    Address,
    soroban_sdk::token::StellarAssetClient<'static>,
    TreasuryContractClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());
    let contract_id = env.register(TreasuryContract, ());
    let client = TreasuryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    client.initialize(&admin, &token_id.address());
    (
        env,
        admin,
        beneficiary,
        token_id.address(),
        token_admin_client,
        client,
    )
}

/// Cliff keeps nothing claimable until `cliff_time`. Math: start=1000,
/// duration=1000, cliff=1500. Before 1500, get_unlocked == 0.
#[test]
fn test_cliff_blocks_pre_cliff() {
    let (env, admin, beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    let cliff_time = 1500u64;
    env.ledger().set_timestamp(start_time);

    client.allocate_budget_with_cliff(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &cliff_time,
        &request_id(&env),
    );

    // Just after start, before cliff: still nothing.
    env.ledger().set_timestamp(start_time + 400);
    assert_eq!(client.get_unlocked(&beneficiary), 0);
    // Right before cliff: still 0.
    env.ledger().set_timestamp(cliff_time - 1);
    assert_eq!(client.get_unlocked(&beneficiary), 0);
}

/// At the cliff timestamp, the linearly-vested amount (counting from
/// `start_time`) becomes available in one go.
#[test]
fn test_cliff_releases_full_vested_amount_at_cliff() {
    let (env, admin, beneficiary, token_addr, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    let cliff_time = 1500u64;
    env.ledger().set_timestamp(start_time);

    client.allocate_budget_with_cliff(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &cliff_time,
        &request_id(&env),
    );

    // At cliff: elapsed = 500, unlock = 1000 * 500 / 1000 = 500.
    env.ledger().set_timestamp(cliff_time);
    assert_eq!(client.get_unlocked(&beneficiary), 500);

    // Claim transfers 500 to the beneficiary.
    let claimed = client.claim(&beneficiary);
    assert_eq!(claimed, 500);
    let token_client = token::TokenClient::new(&env, &token_addr);
    assert_eq!(token_client.balance(&beneficiary), 500);
}

/// After the cliff, linear vesting resumes normally. Math: post-cliff at
/// 2000 returns 1000 (already-claimed + newly unlocked = 500 + 500 = 1000).
#[test]
fn test_cliff_post_cliff_linear_vesting_resumes() {
    let (env, admin, beneficiary, token_addr, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    let cliff_time = 1500u64;
    env.ledger().set_timestamp(start_time);

    client.allocate_budget_with_cliff(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &cliff_time,
        &request_id(&env),
    );

    // At cliff: 500 unlocked (we don't claim here).
    env.ledger().set_timestamp(cliff_time);
    assert_eq!(client.get_unlocked(&beneficiary), 500);

    // Past cliff: 800 unlocked.
    env.ledger().set_timestamp(start_time + 800);
    assert_eq!(client.get_unlocked(&beneficiary), 800);

    // End of stream: 1000 unlocked.
    env.ledger().set_timestamp(start_time + 1000);
    assert_eq!(client.get_unlocked(&beneficiary), 1000);

    // Claim the full remainder.
    let claimed = client.claim(&beneficiary);
    assert_eq!(claimed, 1000);
    let token_client = token::TokenClient::new(&env, &token_addr);
    assert_eq!(token_client.balance(&beneficiary), 1000);
}

/// `cliff_time == 0` is documented to be functionally equivalent to
/// `allocate_budget`. This guards the regression risk for downstream tools
/// that might gate based on whether a stream has a cliff.
#[test]
fn test_cliff_zero_matches_legacy_behavior() {
    let (env, admin, beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    client.allocate_budget_with_cliff(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &0u64, // no cliff
        &request_id(&env),
    );

    // At halfway: linear vesting, identical to legacy.
    env.ledger().set_timestamp(start_time + 500);
    assert_eq!(client.get_unlocked(&beneficiary), 500);
    assert_eq!(client.get_cliff(&beneficiary), 0);

    // At end: fully unlocked.
    env.ledger().set_timestamp(start_time + 1000);
    assert_eq!(client.get_unlocked(&beneficiary), 1000);
}

/// Cliff before start_time is rejected with InvalidCliffTime.
#[test]
fn test_cliff_rejected_before_start() {
    let (env, admin, beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    // cliff_time < start_time — invalid.
    let result = client.try_allocate_budget_with_cliff(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &500u64,
        &request_id(&env),
    );
    assert_eq!(result, Err(Ok(TreasuryError::InvalidCliffTime)));
}

/// Cliff strictly after `start_time + duration` is rejected so the cliff
/// cannot accidentally lock up tokens past the natural vesting endpoint.
#[test]
fn test_cliff_rejected_after_end() {
    let (env, admin, beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    // cliff_time > start_time + duration — invalid.
    let result = client.try_allocate_budget_with_cliff(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &2500u64,
        &request_id(&env),
    );
    assert_eq!(result, Err(Ok(TreasuryError::InvalidCliffTime)));
}

/// Backward compat: legacy `allocate_budget` succeeds against a beneficiary
/// that previously held a V2 stream. The new V1 allocation deletes the V2
/// row, so the V1 schedule (no cliff) becomes the active one — matching
/// the legacy "latest allocation wins" semantic.
#[test]
fn test_v1_allocation_replaces_v2_record() {
    let (env, admin, beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &2000);
    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    // V2 cliff stream first.
    client.allocate_budget_with_cliff(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &1500u64,
        &fresh_request_id(&env, 1),
    );
    assert_eq!(client.get_cliff(&beneficiary), 1500);

    // Legacy V1 allocation drops the V2 row and writes a fresh V1 row.
    // (Returns `()` on the void client method; panics internally on error.)
    client.allocate_budget(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &fresh_request_id(&env, 2),
    );

    // Cliff is gone — the record is now a pure V1 stream.
    assert_eq!(client.get_cliff(&beneficiary), 0);

    // Math is now linear from start_time, no cliff lockout.
    env.ledger().set_timestamp(start_time + 200);
    assert_eq!(client.get_unlocked(&beneficiary), 200);
}

/// Symmetric to the V1-overwrites-V2 case: a V2 cliff allocation replaces
/// any pre-existing V1 record. Used as evidence of "latest allocation wins"
/// holding in both directions.
#[test]
fn test_v2_allocation_replaces_v1_record() {
    let (env, admin, beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &2000);
    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    // V1 (no cliff) first.
    client.allocate_budget(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &fresh_request_id(&env, 1),
    );
    assert_eq!(client.get_cliff(&beneficiary), 0);

    // V2 allocation overwrites: drop V1 row, write V2 row with cliff.
    client.allocate_budget_with_cliff(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &1500u64,
        &fresh_request_id(&env, 2),
    );

    // Now there is a cliff on the record.
    assert_eq!(client.get_cliff(&beneficiary), 1500);

    // Cliff lockout applies — pre-cliff returns 0.
    env.ledger().set_timestamp(start_time + 200);
    assert_eq!(client.get_unlocked(&beneficiary), 0);
}

/// `claim` returns NothingToClaim before the cliff even though elapsed
/// time would have unlocked tokens. Mirrors `get_unlocked` semantics but
/// ensures the claim entry point agrees.
#[test]
fn test_claim_before_cliff_rejected() {
    let (env, admin, beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    let cliff_time = 1500u64;
    env.ledger().set_timestamp(start_time);

    client.allocate_budget_with_cliff(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &cliff_time,
        &request_id(&env),
    );

    // Halfway between start and cliff.
    env.ledger().set_timestamp(start_time + 200);
    assert_eq!(
        client.try_claim(&beneficiary),
        Err(Ok(TreasuryError::NothingToClaim))
    );
}

/// `preview_unlocked_at` returns 0 before cliff and total at end,
/// independent of whether anyone has claimed.
#[test]
fn test_preview_unlocked_at_pre_end_of_stream() {
    let (env, admin, beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    let cliff_time = 1500u64;
    env.ledger().set_timestamp(start_time);

    client.allocate_budget_with_cliff(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &cliff_time,
        &request_id(&env),
    );

    // Pre-start.
    assert_eq!(client.preview_unlocked_at(&beneficiary, &500u64), 0);
    // Pre-cliff (still returns 0 even though elapsed-from-start > 0).
    assert_eq!(client.preview_unlocked_at(&beneficiary, &1100u64), 0);
    // At cliff (elapsed-from-start = 500/1000, unlock = 500).
    assert_eq!(client.preview_unlocked_at(&beneficiary, &cliff_time), 500);
    // Mid-stream post-cliff.
    assert_eq!(client.preview_unlocked_at(&beneficiary, &1800u64), 800);
    // At end of stream.
    assert_eq!(client.preview_unlocked_at(&beneficiary, &2000u64), 1000);
    // Past end (clamped to total).
    assert_eq!(client.preview_unlocked_at(&beneficiary, &5000u64), 1000);
}

/// `preview_schedule` returns monotonically non-decreasing cumulative
/// values across the cliff boundary.
#[test]
fn test_preview_schedule_monotonic_across_cliff() {
    let (env, admin, beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    let cliff_time = 1500u64;
    env.ledger().set_timestamp(start_time);

    client.allocate_budget_with_cliff(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &cliff_time,
        &request_id(&env),
    );

    // Sample 200s steps from t=start: 1000 .. 2200.
    let schedule = client.preview_schedule(&beneficiary, &200u64, &7u32);
    assert_eq!(schedule.len(), 7);

    // First entry is the current ledger time itself (start_time=1000).
    // cliff_time == start_time + 500, so before cliff the unlocked is 0.
    assert_eq!(schedule.get(0).unwrap().at, 1000);
    assert_eq!(schedule.get(0).unwrap().cumulative_unlocked, 0);

    // 1200: still before cliff.
    assert_eq!(schedule.get(1).unwrap().at, 1200);
    assert_eq!(schedule.get(1).unwrap().cumulative_unlocked, 0);

    // 1400: still before cliff (cliff == 1500).
    assert_eq!(schedule.get(2).unwrap().at, 1400);
    assert_eq!(schedule.get(2).unwrap().cumulative_unlocked, 0);

    // 1600: just past cliff, elapsed = 600 / 1000 = 600 unlock.
    assert_eq!(schedule.get(3).unwrap().at, 1600);
    assert_eq!(schedule.get(3).unwrap().cumulative_unlocked, 600);

    // Monotonic sanity: cumulative >= previous.
    // Use an index loop because Soroban's Vec iterator does not guarantee
    // `windows`/`Iterator` chaining behaves identically to the std iterator.
    let len = schedule.len();
    for i in 1..len {
        let prev = schedule.get(i - 1).unwrap();
        let next = schedule.get(i).unwrap();
        assert!(
            next.cumulative_unlocked >= prev.cumulative_unlocked,
            "schedule must be non-decreasing across {}",
            next.at
        );
        assert!(next.at > prev.at, "timestamps must be increasing");
    }
}

/// Negative paths for preview_schedule: zero-interval, zero steps, and too
/// many steps are all rejected.
#[test]
fn test_preview_schedule_input_validation() {
    let (env, admin, beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    client.allocate_budget(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &request_id(&env),
    );

    // Zero step interval.
    assert_eq!(
        client.try_preview_schedule(&beneficiary, &0u64, &5u32),
        Err(Ok(TreasuryError::InvalidScheduleStep))
    );
    // Zero steps.
    assert_eq!(
        client.try_preview_schedule(&beneficiary, &100u64, &0u32),
        Err(Ok(TreasuryError::InvalidScheduleStep))
    );
    // Steps over MAX_INSTALLMENTS cap (50).
    assert_eq!(
        client.try_preview_schedule(&beneficiary, &100u64, &51u32),
        Err(Ok(TreasuryError::TooManyInstallments))
    );
}

/// Cancel during the cliff window refunds the full amount (nothing had
/// unlocked yet) and reports 0 unlocked.
#[test]
fn test_cliff_cancel_pre_cliff_refunds_full() {
    let (env, admin, beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    let cliff_time = 1500u64;
    env.ledger().set_timestamp(start_time);

    client.allocate_budget_with_cliff(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &cliff_time,
        &request_id(&env),
    );

    // Halfway between start and cliff.
    env.ledger().set_timestamp(start_time + 200);

    let (total_unlocked, refunded) = client.cancel_stream(&admin, &beneficiary);
    assert_eq!(total_unlocked, 0);
    assert_eq!(refunded, 1000);
}

/// Cancel after the cliff respects the linear vesting math: refundable
/// equals the leftover (allocated - cumulative unlocked), and total_unlocked
/// reflects the linear curve.
#[test]
fn test_cliff_cancel_post_cliff_refund_math() {
    let (env, admin, beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    let cliff_time = 1500u64;
    env.ledger().set_timestamp(start_time);

    client.allocate_budget_with_cliff(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &cliff_time,
        &request_id(&env),
    );

    // Past cliff, halfway to end (i.e. halfway through the linear window).
    env.ledger().set_timestamp(start_time + 750);

    let (total_unlocked, refunded) = client.cancel_stream(&admin, &beneficiary);
    // At 1750: elapsed=750/1000, cumulative=750.
    assert_eq!(total_unlocked, 750);
    assert_eq!(refunded, 250);
}

/// Rotating a cliff stream when no claim has been made yet preserves the
/// original vesting schedule (start_time, duration, cliff_time). The new
/// beneficiary inherits the same linear curve from the original start_time.
/// Math here: start=1000, cliff=1500, duration=1000. At t=1500 elapsed=500,
/// unlock=500; at t=2000 the stream is fully vested, unlock=1000.
#[test]
fn test_cliff_rotate_before_claims_preserves_offset() {
    let (env, admin, old_beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    let cliff_time = 1500u64;
    env.ledger().set_timestamp(start_time);

    client.allocate_budget_with_cliff(
        &admin,
        &old_beneficiary,
        &1000,
        &start_time,
        &duration,
        &cliff_time,
        &request_id(&env),
    );

    let new_beneficiary = Address::generate(&env);
    // Rotate before any claims: stream fields are unchanged, just the
    // beneficiary pointer moves.
    env.ledger().set_timestamp(1500);
    client.rotate_beneficiary(&admin, &old_beneficiary, &new_beneficiary);

    // The cliff is preserved. At t=1500 the cliff is reached, so linear
    // vesting from the original start_time gives unlock = 500.
    assert_eq!(client.get_unlocked(&new_beneficiary), 500);
    // Cliff still in place on the rotated record.
    assert_eq!(client.get_cliff(&new_beneficiary), cliff_time);

    // At t=2000 (full duration elapsed from start_time): 1000.
    env.ledger().set_timestamp(2000);
    assert_eq!(client.get_unlocked(&new_beneficiary), 1000);
}

/// Rotating a cliff stream *after* partial claims restarts the clock on
/// the remaining amount, but preserves the cliff offset relative to the
/// new start so the new beneficiary's vesting schedule mirrors the
/// original.
#[test]
fn test_cliff_rotate_after_partial_claim_preserves_offset() {
    let (env, admin, old_beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    let cliff_time = 1500u64;
    env.ledger().set_timestamp(start_time);

    client.allocate_budget_with_cliff(
        &admin,
        &old_beneficiary,
        &1000,
        &start_time,
        &duration,
        &cliff_time,
        &request_id(&env),
    );

    // Past cliff, claim half the stream so claimed_amount=500.
    env.ledger().set_timestamp(cliff_time);
    assert_eq!(client.claim(&old_beneficiary), 500);

    // Rotate at t=2000. reset_remaining shifts the cliff to the new start
    // time + the original cliff offset (500s).
    let new_beneficiary = Address::generate(&env);
    env.ledger().set_timestamp(2000);
    client.rotate_beneficiary(&admin, &old_beneficiary, &new_beneficiary);

    // Cliff preserved: 2000 + 500 = 2500.
    assert_eq!(client.get_cliff(&new_beneficiary), 2500);

    // Pre-new-cliff: nothing unlocked for the new beneficiary.
    env.ledger().set_timestamp(2400);
    assert_eq!(client.get_unlocked(&new_beneficiary), 0);

    // At the new cliff time: the remaining 500 unlocks all at once
    // (because reset_remaining sets duration=0).
    env.ledger().set_timestamp(2500);
    assert_eq!(client.get_unlocked(&new_beneficiary), 500);
}

/// `get_cliff` returns 0 for legacy V1 streams, the configured cliff for
/// V2 streams, and StreamNotFound when no stream is present.
#[test]
fn test_get_cliff_for_v1_and_v2_streams() {
    let (env, admin, beneficiary_v1, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    env.ledger().set_timestamp(1000);

    // V1 stream — get_cliff returns 0.
    client.allocate_budget(
        &admin,
        &beneficiary_v1,
        &500,
        &1000,
        &1000,
        &fresh_request_id(&env, 1),
    );
    assert_eq!(client.get_cliff(&beneficiary_v1), 0);

    // V2 stream — get_cliff returns the configured cliff.
    let beneficiary_v2 = Address::generate(&env);
    client.allocate_budget_with_cliff(
        &admin,
        &beneficiary_v2,
        &500,
        &1000,
        &1000,
        &1500u64,
        &fresh_request_id(&env, 2),
    );
    assert_eq!(client.get_cliff(&beneficiary_v2), 1500);

    // No stream — StreamNotFound.
    let nobody = Address::generate(&env);
    assert_eq!(
        client.try_get_cliff(&nobody),
        Err(Ok(TreasuryError::StreamNotFound))
    );
}

/// Backward compat: legacy V1 streams continue to be readable through all
/// public methods after the V2 infrastructure was added.
#[test]
fn test_v1_streams_readable_through_v2_paths() {
    let (env, admin, beneficiary, _, stellar, client) = make_env_with_token();
    stellar.mint(&admin, &1000);
    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    client.allocate_budget(
        &admin,
        &beneficiary,
        &1000,
        &start_time,
        &duration,
        &request_id(&env),
    );

    // All read-only methods work against the V1 stream.
    env.ledger().set_timestamp(start_time + 500);
    assert_eq!(client.get_unlocked(&beneficiary), 500);
    assert_eq!(client.get_cliff(&beneficiary), 0);
    assert_eq!(client.preview_unlocked_at(&beneficiary, &1500u64), 500);
    assert_eq!(client.preview_unlocked_at(&beneficiary, &2500u64), 1000);

    let schedule = client.preview_schedule(&beneficiary, &500u64, &3u32);
    assert_eq!(schedule.len(), 3);

    // Claim path also works.
    let claimed = client.claim(&beneficiary);
    assert_eq!(claimed, 500);
}
