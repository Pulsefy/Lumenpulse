//! Stellar Asset Contract helpers.

use soroban_sdk::{
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

/// Register a Stellar Asset Contract administered by `admin`.
///
/// Returns the read client ([`TokenClient`], for `balance`/`transfer`) and the
/// administrative client ([`StellarAssetClient`], for `mint`/`set_admin`).
/// Both are thin wrappers around the same contract address — use
/// [`TokenClient::address`] if you need the address itself.
pub fn create_token<'a>(env: &Env, admin: &Address) -> (TokenClient<'a>, StellarAssetClient<'a>) {
    let contract = env.register_stellar_asset_contract_v2(admin.clone());
    let address = contract.address();
    (
        TokenClient::new(env, &address),
        StellarAssetClient::new(env, &address),
    )
}

/// Mint `amount` of a Stellar Asset Contract token to `to`.
pub fn mint(admin: &StellarAssetClient, to: &Address, amount: i128) {
    admin.mint(to, &amount);
}
