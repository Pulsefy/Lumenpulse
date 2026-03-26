#[cfg(test)]
mod reentrancy_tests {
    use crate::errors::VestingError;
    use crate::reentrancy_guard;
    use crate::{VestingWalletContract, VestingWalletContractClient};
    use soroban_sdk::{
        testutils::Address as _,
        token::{StellarAssetClient, TokenClient},
        Address, Env,
    };

    fn create_token_contract<'a>(
        env: &Env,
        admin: &Address,
    ) -> (TokenClient<'a>, StellarAssetClient<'a>) {
        let contract_address = env.register_stellar_asset_contract_v2(admin.clone());
        (
            TokenClient::new(env, &contract_address.address()),
            StellarAssetClient::new(env, &contract_address.address()),
        )
    }

    fn setup_test<'a>(
        env: &Env,
    ) -> (
        VestingWalletContractClient<'a>,
        Address,
        Address,
        TokenClient<'a>,
    ) {
        let admin = Address::generate(env);
        let beneficiary = Address::generate(env);

        let (token_client, token_admin_client) = create_token_contract(env, &admin);
        token_admin_client.mint(&admin, &10_000_000);

        let contract_id = env.register(VestingWalletContract, ());
        let client = VestingWalletContractClient::new(env, &contract_id);

        (client, admin, beneficiary, token_client)
    }

    #[test]
    fn test_reentrancy_guard_lock_unlock() {
        let env = Env::default();

        assert!(reentrancy_guard::lock(&env));
        assert!(reentrancy_guard::is_locked(&env));

        assert!(!reentrancy_guard::lock(&env));

        reentrancy_guard::unlock(&env);
        assert!(!reentrancy_guard::is_locked(&env));

        assert!(reentrancy_guard::lock(&env));
    }

    #[test]
    fn test_create_vesting_reentrancy_protection() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, admin, beneficiary, token_client) = setup_test(&env);

        client.initialize(&admin, &token_client.address);

        // Manually lock the guard
        reentrancy_guard::lock(&env);

        // Attempt create_vesting should fail
        let current_time = env.ledger().timestamp();
        let result = client.try_create_vesting(&admin, &beneficiary, &1000, &(current_time + 100), &1000);
        assert_eq!(result, Err(Ok(VestingError::ReentrancyDetected)));

        // Unlock and try again
        reentrancy_guard::unlock(&env);
        client.create_vesting(&admin, &beneficiary, &1000, &(current_time + 100), &1000);
    }

    #[test]
    fn test_claim_reentrancy_protection() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, admin, beneficiary, token_client) = setup_test(&env);

        client.initialize(&admin, &token_client.address);

        let current_time = env.ledger().timestamp();
        client.create_vesting(&admin, &beneficiary, &1000, &current_time, &1000);

        // Fast forward time
        env.ledger().with_mut(|li| li.timestamp = current_time + 500);

        // Manually lock the guard
        reentrancy_guard::lock(&env);

        // Attempt claim should fail
        let result = client.try_claim(&beneficiary);
        assert_eq!(result, Err(Ok(VestingError::ReentrancyDetected)));

        // Unlock and try again
        reentrancy_guard::unlock(&env);
        client.claim(&beneficiary);
    }

    #[test]
    fn test_nested_calls_fail() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, admin, beneficiary, token_client) = setup_test(&env);

        client.initialize(&admin, &token_client.address);

        let current_time = env.ledger().timestamp();
        
        // First create succeeds
        client.create_vesting(&admin, &beneficiary, &1000, &current_time, &1000);

        // Simulate nested call
        reentrancy_guard::lock(&env);
        let result = client.try_create_vesting(&admin, &beneficiary, &1000, &(current_time + 100), &1000);
        assert_eq!(result, Err(Ok(VestingError::ReentrancyDetected)));
    }
}
