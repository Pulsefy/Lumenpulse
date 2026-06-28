# #584 Yield-bearing Vault Extensions (Mock Integration)

## Overview

This document describes the implementation of a **Yield-bearing Vault System** that integrates the Crowdfund Vault with multiple Soroban liquidity protocols to earn yield on idle funds awaiting milestone release. The system implements a multi-provider yield optimization strategy.

## Architecture

### Core Components

#### 1. **YieldVault Contract**
- **Location**: `contracts/yield_vault/src/lib.rs`
- **Purpose**: Multi-provider yield optimization wrapper
- **Key Features**:
  - Multi-protocol provider support
  - Priority-based allocation
  - Automatic yield harvesting
  - User balance tracking and claims

#### 2. **Mock Yield Providers**

##### a. **Aave Lending Pool** (Mock Aave Protocol)
- **Location**: `contracts/aave_lending_pool/src/lib.rs`
- **Purpose**: Simulates Aave-style lending protocol
- **Features**:
  - Multiple reserve tokens
  - Interest accrual on deposits
  - Variable APY based on utilization
  - aToken (interest-bearing token) mechanics

##### b. **Stable Swap Pool** (Mock Curve Protocol)
- **Location**: `contracts/stable_swap_pool/src/lib.rs`
- **Purpose**: Simulates Curve-style stablecoin AMM
- **Features**:
  - Stable token swaps with low slippage
  - LP token yield from trading fees
  - Amplification factor for bonding curve
  - Swap fees distributed to liquidity providers

##### c. **Liquidity Pool** (Mock Uniswap Protocol)
- **Location**: `contracts/liquidity_pool/src/lib.rs`
- **Purpose**: Simulates Uniswap v2-style AMM
- **Features**:
  - Constant product formula (x * y = k)
  - LP token mechanics
  - Trading fees (0.3%) distributed to LPs
  - Slippage protection

### Data Models

#### YieldProvider Structure
```rust
pub struct YieldProvider {
    pub id: u32,                    // Unique provider ID
    pub name: Symbol,               // Provider name (e.g., "aave", "curve")
    pub address: Address,           // Contract address
    pub priority: u32,              // Higher = preferred for deposits
    pub total_deposited: i128,      // Cumulative deposits
    pub total_withdrawn: i128,      // Cumulative withdrawals
    pub total_yield_earned: i128,   // Harvested yield
    pub is_active: bool,            // Active/inactive flag
}
```

#### Provider Metrics
```rust
pub struct ProviderMetrics {
    pub apy: u32,           // Annual percentage yield (basis points, e.g., 500 = 5%)
    pub tvl: i128,          // Total value locked
    pub risk_rating: u8,    // Risk rating 1-10 (1 = lowest risk)
}
```

#### Storage Keys
```rust
pub enum DataKey {
    Admin,
    Asset,                                  // Asset token address
    ProviderCount,                          // Total providers registered
    Provider(u32),                          // YieldProvider info
    UserBalance(Address),                   // Total user deposit
    UserProviderAllocation(Address, u32),   // Per-provider allocation
    TotalAUM,                               // Total assets under management
    TotalYieldHarvested,                    // Accumulated harvested yield
}
```

## Usage Pattern

### Step 1: Initialize Vault
```
YieldVault.initialize(
    admin: Address,
    asset: Address  // e.g., USDC token
)
```

### Step 2: Register Providers
```
provider_id_1 = YieldVault.register_provider(
    name: "aave",
    address: aave_contract,
    priority: 100
)

provider_id_2 = YieldVault.register_provider(
    name: "curve",
    address: curve_contract,
    priority: 80
)

provider_id_3 = YieldVault.register_provider(
    name: "uniswap",
    address: uniswap_contract,
    priority: 60
)
```

### Step 3: User Deposits
```
YieldVault.deposit(
    amount: 1_000_000,  // USDC amount
    user: user_address
)
// Automatically routes to highest-priority active provider
```

### Step 4: Harvest Yields
```
yield_earned = YieldVault.harvest_yield(provider_id)
// Yield is tracked for later distribution to users
```

### Step 5: User Withdrawals
```
YieldVault.withdraw(
    amount: 500_000,
    user: user_address
)
// Withdraws from providers in FIFO order
```

## Protocol Integration Details

### Aave Lending Pool Integration

**Key Concept**: Users deposit stablecoins and receive aTokens that accrue interest.

```rust
// Deposit 1,000 USDC
aave.deposit(USDC, 1_000, user)
// Returns: ~1,000 aUSDC (interest-bearing token)

// After time, aUSDC value increases relative to USDC
// Interest accrual formula:
// underlying_amount = (atoken_amount * reserve_total) / atoken_supply
```

**Integration with YieldVault**:
- YieldVault receives aUSDC from Aave deposit
- Tracks: `total_deposited = 1,000`, `total_yield = aUSDC_growth`
- When harvesting, calculates: `yield = (atoken_balance - total_deposited)`

### Curve Stable Swap Integration

**Key Concept**: Users provide liquidity to stablecoin pairs and earn fees.

```rust
// Add liquidity: 500 USDC + 500 USDT
curve.add_liquidity(500, 500, min_lp=400)
// Returns: ~990 LP tokens

// Yield comes from:
// 1. Swap fees (0.04%) - 1% to LP providers
// 2. Price appreciation if one stablecoin demands premium
```

**Integration with YieldVault**:
- YieldVault provides capital for stable pair
- Receives LP tokens earning trading fees
- Tracks LP token balance as invested amount
- Yield = (LP token balance growth + fee accrual)

### Uniswap Liquidity Pool Integration

**Key Concept**: Users provide liquidity to token pairs using constant product AMM.

```rust
// Add liquidity: 100 TOKEN_A + 100 TOKEN_B
uniswap.add_liquidity(100, 100, min_lp=99)
// Returns: ~99.95 LP tokens

// Yield comes from:
// 1. Swap fees (0.3%) - distributed to LP holders
// 2. Price appreciation (impermanent loss risk)
```

**Integration with YieldVault**:
- YieldVault provides liquidity to stable pairs (minimal IL risk)
- Tracks LP token amount
- Yield = (LP token balance + swap fees) - (initial deposit)

## Yield Optimization Strategy

### Allocation Algorithm
```
1. Find highest-priority active provider
2. Deposit all new deposits to that provider
3. If provider becomes inactive, future deposits go to next priority
4. Users can withdraw from any provider (FIFO)
```

### Priority System
```
Priority 100: Aave (Stable, 5-6% APY)
Priority 80:  Curve (Stable, 3-4% APY)
Priority 60:  Uniswap (Variable, 2-8% APY)
```

### Harvest Flow
```
1. Query provider's current balance
2. Calculate yield: balance - deposited + withdrawn
3. Record yield_earned in provider metrics
4. Accumulate in TotalYieldHarvested
5. Yield available for distribution
```

## Key Features

### 1. Multi-Provider Support
- Register unlimited yield providers
- Each tracked independently
- Dynamic activation/deactivation

### 2. Automatic Allocation
- New deposits go to highest-priority provider
- Efficient capital deployment
- No manual intervention needed

### 3. Yield Tracking
- Per-provider yield metrics
- User balance tracking
- Total AUM (Assets Under Management)

### 4. Flexible Withdrawals
- FIFO provider ordering
- Partial withdrawals supported
- Automatic balance updates

### 5. Events for Monitoring
- DepositEvent: User deposits
- WithdrawEvent: User withdrawals
- ProviderRegisteredEvent: New provider
- YieldHarvestedEvent: Yield harvesting

## Integration with Crowdfund Vault

### Use Case: Earning Yield on Milestone Escrow

**Scenario**: Crowdfund project collects funds but awaits milestone verification before release.

```
Timeline:
1. Funds collected → YieldVault deposit
2. Funds earning yield (5-6% APY) → Aave
3. Milestone verified → Withdraw to project
4. Yield → Distributed to backers or protocol
```

**Benefits**:
- Idle capital becomes productive
- Users earn on their commitment
- Project receives full amount + bonus from yield
- Protocol incentivizes milestone completion

### Integration Points

```rust
// In CrowdfundVault:
deposit_for_milestone(project_id, amount, user) {
    // 1. Escrow user's funds
    // 2. Deposit to YieldVault for yield generation
    yield_vault.deposit(amount, escrow_address);
    
    // 3. Track allocation in escrow
    escrow[project_id] += amount;
}

// When milestone reached:
release_milestone_funds(project_id) {
    // 1. Calculate yield earned
    yield_earned = yield_vault.get_user_yield(escrow_address);
    
    // 2. Withdraw principal
    yield_vault.withdraw(escrow[project_id], project);
    
    // 3. Distribute yield (optional)
    distribute_yield_to_backers(yield_earned);
}
```

## Events

### VaultInitializedEvent
```rust
pub fn emit_vault_initialized(admin: Address, asset: Address)
```

### ProviderRegisteredEvent
```rust
pub fn emit_provider_registered(
    provider_id: u32,
    name: Symbol,
    address: Address,
    priority: u32
)
```

### DepositEvent
```rust
pub fn emit_deposit(user: Address, amount: i128, provider_id: u32)
```

### WithdrawEvent
```rust
pub fn emit_withdraw(user: Address, amount: i128)
```

### YieldHarvestedEvent
```rust
pub fn emit_yield_harvested(provider_id: u32, yield_earned: i128)
```

## Storage Layout

### Instance Storage (Always Available)
- `Admin`: Vault administrator
- `Asset`: Asset token address
- `ProviderCount`: Number of registered providers

### Persistent Storage (For Historical Data)
- `Provider(id)`: Provider information
- `UserBalance(user)`: User's total balance
- `UserProviderAllocation(user, provider_id)`: Per-provider allocation
- `TotalAUM`: Total assets under management
- `TotalYieldHarvested`: Cumulative harvested yield

## Performance Characteristics

| Operation | Time Complexity | Space | Notes |
|-----------|-----------------|-------|-------|
| Register Provider | O(1) | O(1) | Constant-time storage |
| Deposit | O(1) | O(1) | Direct to best provider |
| Withdraw | O(p) | O(1) | p = providers (typically 3-5) |
| Harvest Yield | O(1) | O(1) | Single provider query |
| Query Balance | O(1) | O(1) | Direct lookup |

## APY Comparison

| Provider | Base APY | Fee | Net APY |
|----------|----------|-----|---------|
| Aave (5%) | 5.0% | 0% | 5.0% |
| Curve (4%) | 4.0% | 0% | 4.0% |
| Uniswap (6%) | 6.0% | 0.3% | 5.7% |

*Note: These are mock rates. Real protocols have variable APYs.*

## Security Considerations

1. **Provider Validation**: Verify provider addresses implement YieldProviderTrait
2. **Access Control**: Only admin can register providers
3. **Balance Verification**: Track total deposited/withdrawn
4. **Yield Calculation**: Conservative (uses actual balance)
5. **Revert Safety**: Partial failure doesn't break vault

## Testing Strategy

1. **Unit Tests**:
   - Provider registration
   - Deposit/withdraw logic
   - Yield calculation
   - Balance queries

2. **Integration Tests**:
   - Multi-provider scenarios
   - Yield harvesting flow
   - Multiple users
   - Provider priority switching

3. **Mock Provider Tests**:
   - Aave interest accrual
   - Curve fee distribution
   - Uniswap LP token mechanics

4. **Stress Tests**:
   - Large deposits
   - Many providers
   - High withdrawal frequency

## Future Enhancements

1. **Dynamic Rebalancing**: Move funds to highest-yield provider daily
2. **Risk Modeling**: Adjust allocation based on provider risk
3. **Composability**: Stack yields (Aave + Curve + Uniswap)
4. **Governance**: DAO control of parameters
5. **Insurance**: Provider failure coverage
6. **Cross-chain**: Bridge yields from other chains
7. **Derivative Strategies**: Option selling for additional yield

## Deployment Checklist

- [x] YieldVault contract implemented
- [x] Aave Lending Pool mock implemented
- [x] Curve Stable Swap mock implemented
- [x] Uniswap Liquidity Pool mock implemented
- [x] Multi-provider tracking
- [x] Yield harvesting logic
- [ ] Integration tests written
- [ ] Performance optimization completed
- [ ] Security audit completed
- [ ] Documentation examples created
- [ ] Crowdfund Vault integration points documented

## Contract Addresses (Mock/Testnet)

```
YieldVault: TBD (after deployment)
AaveLendingPool: TBD
StableSwapPool: TBD
LiquidityPool: TBD
```

## References

- [Aave Protocol](https://aave.com)
- [Curve Finance](https://curve.fi)
- [Uniswap V2](https://uniswap.org)
- [Soroban SDK Documentation](https://developers.stellar.org/docs/smart-contracts)
