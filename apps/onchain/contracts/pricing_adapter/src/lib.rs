#![no_std]

mod errors;
mod events;
mod storage;

use errors::PricingAdapterError;
use soroban_sdk::{contract, contractimpl, Address, Env};
use storage::DataKey;

pub const BASE_DECIMALS: u32 = 7;

#[contract]
pub struct PricingAdapterContract;

#[contractimpl]
impl PricingAdapterContract {
    /// Initialize the contract with an admin address
    pub fn initialize(env: Env, admin: Address) -> Result<(), PricingAdapterError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(PricingAdapterError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);

        let event = events::InitializedEvent { admin };
        event.publish(&env);
        Ok(())
    }

    /// Set the price for a specific asset. Price should be scaled by 10^7 (BASE_DECIMALS).
    /// `asset_decimals` specifies the decimal places of the original asset token.
    pub fn set_price(
        env: Env,
        admin: Address,
        asset: Address,
        price: i128,
        asset_decimals: u32,
    ) -> Result<(), PricingAdapterError> {
        Self::require_admin(&env, &admin)?;
        if price <= 0 {
            return Err(PricingAdapterError::InvalidPrice);
        }

        env.storage()
            .persistent()
            .set(&DataKey::AssetPrice(asset.clone()), &price);
        env.storage()
            .persistent()
            .set(&DataKey::AssetDecimals(asset.clone()), &asset_decimals);

        let event = events::PriceUpdatedEvent {
            admin,
            asset,
            price,
        };
        event.publish(&env);
        Ok(())
    }

    /// Get the current configured price of an asset
    pub fn get_price(env: Env, asset: Address) -> Result<i128, PricingAdapterError> {
        env.storage()
            .persistent()
            .get(&DataKey::AssetPrice(asset))
            .ok_or(PricingAdapterError::PriceNotFound)
    }

    /// Get the decimals configured for an asset (defaults to 7)
    pub fn get_asset_decimals(env: Env, asset: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::AssetDecimals(asset))
            .unwrap_or(BASE_DECIMALS)
    }

    /// Normalizes an asset amount into its base equivalent value (scaled to 7 decimals).
    pub fn normalize_amount(
        env: Env,
        asset: Address,
        amount: i128,
    ) -> Result<i128, PricingAdapterError> {
        if amount == 0 {
            return Ok(0);
        }

        let price = Self::get_price(env.clone(), asset.clone())?;
        let decimals = Self::get_asset_decimals(env.clone(), asset);

        // Normalized amount = (amount * price) / 10^asset_decimals
        let base: i128 = 10;
        let denominator = base.pow(decimals);

        let normalized = amount
            .checked_mul(price)
            .and_then(|v| v.checked_div(denominator))
            .unwrap_or(0);

        Ok(normalized)
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), PricingAdapterError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(PricingAdapterError::NotInitialized)?;
        if caller != &admin {
            return Err(PricingAdapterError::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }
}

#[cfg(test)]
mod test;
