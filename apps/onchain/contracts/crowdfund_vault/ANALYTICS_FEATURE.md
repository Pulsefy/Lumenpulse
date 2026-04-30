# On-Chain Analytics: TVL and Volume Tracking

## Overview

This feature implements trustless, on-chain analytics for the Lumenpulse crowdfunding protocol. It maintains high-level protocol statistics directly on the blockchain, enabling transparent and verifiable reporting without relying on off-chain indexers or centralized data sources.

## Metrics Tracked

### 1. Total Value Locked (TVL)
- **Definition**: The current total amount of funds locked across all active projects in the protocol
- **Behavior**: 
  - Increases when users deposit funds into projects
  - Decreases when project owners withdraw funds
  - Decreases when contributors receive refunds or clawbacks
- **Use Cases**: 
  - Protocol health monitoring
  - Risk assessment
  - Liquidity analysis

### 2. Cumulative Funding Volume
- **Definition**: The total amount of funds that have flowed into the protocol since inception
- **Behavior**: 
  - Monotonically increasing (never decreases)
  - Increases only on deposits
  - Unaffected by withdrawals or refunds
- **Use Cases**: 
  - Historical activity tracking
  - Growth metrics
  - Total economic throughput

## Implementation Details

### Storage Structure

The analytics are stored in the `ProtocolStats` struct in instance storage:

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolStats {
    pub tvl: i128,
    pub cumulative_volume: i128,
}
```

### Storage Location
- **Storage Type**: Instance storage (cheaper than persistent storage)
- **Key**: `DataKey::ProtocolStats`
- **Initialization**: Set to `{tvl: 0, cumulative_volume: 0}` during contract initialization

### Automatic Updates

The protocol stats are automatically updated in the following functions:

#### On Deposit (`deposit()`)
```rust
stats.tvl += amount;
stats.cumulative_volume += amount;
```

#### On Withdrawal (`withdraw()`)
```rust
stats.tvl -= amount;
// cumulative_volume remains unchanged
```

#### On Refund (`refund_contributors()`)
```rust
stats.tvl -= total_refunded;
// cumulative_volume remains unchanged
```

#### On Clawback (`clawback_contribution()`)
```rust
stats.tvl -= amount;
// cumulative_volume remains unchanged
```

## Public API

### Get Complete Protocol Statistics
```rust
pub fn get_protocol_stats(env: Env) -> Result<ProtocolStats, CrowdfundError>
```
Returns both TVL and cumulative volume in a single call.

**Example Usage:**
```rust
let stats = client.get_protocol_stats();
println!("TVL: {}, Volume: {}", stats.tvl, stats.cumulative_volume);
```

### Get Current TVL
```rust
pub fn get_tvl(env: Env) -> Result<i128, CrowdfundError>
```
Returns only the current Total Value Locked.

**Example Usage:**
```rust
let tvl = client.get_tvl();
println!("Current TVL: {}", tvl);
```

### Get Cumulative Volume
```rust
pub fn get_cumulative_volume(env: Env) -> Result<i128, CrowdfundError>
```
Returns only the cumulative funding volume.

**Example Usage:**
```rust
let volume = client.get_cumulative_volume();
println!("All-time volume: {}", volume);
```

## Testing

Comprehensive test coverage includes:

1. **Initialization Tests**
   - `test_protocol_stats_initialized_to_zero`: Verifies stats start at zero

2. **TVL Tests**
   - `test_tvl_increases_on_deposit`: TVL increases with deposits
   - `test_tvl_decreases_on_withdrawal`: TVL decreases with withdrawals
   - `test_tvl_with_multiple_projects`: TVL aggregates across projects
   - `test_tvl_decreases_on_refund`: TVL decreases when refunds occur
   - `test_tvl_with_clawback`: TVL decreases on clawback

3. **Volume Tests**
   - `test_cumulative_volume_is_monotonic`: Volume never decreases

4. **Integration Tests**
   - `test_protocol_stats_struct_returns_both_metrics`: Struct getter works correctly
   - `test_analytics_across_project_lifecycle`: Full lifecycle tracking

## Gas Efficiency

- **Storage**: Uses instance storage (cheaper than persistent)
- **Updates**: Atomic updates during existing operations (no extra transactions)
- **Reads**: Single storage read for all stats via `get_protocol_stats()`

## Security Considerations

1. **Trustless**: All calculations happen on-chain with no external dependencies
2. **Atomic**: Stats are updated atomically with fund movements
3. **Immutable History**: Cumulative volume provides tamper-proof historical record
4. **No Admin Control**: Stats cannot be manually manipulated, even by admin

## Use Cases

### For Protocol Operators
- Monitor protocol health and growth
- Track total economic activity
- Identify trends and patterns

### For Users
- Verify protocol transparency
- Assess protocol size and activity
- Make informed participation decisions

### For Integrators
- Build dashboards and analytics tools
- Create protocol metrics APIs
- Develop monitoring and alerting systems

### For Auditors
- Verify fund flows
- Audit protocol activity
- Validate economic claims

## Future Enhancements

Potential future additions:
1. Per-token TVL and volume tracking
2. Time-series snapshots for historical analysis
3. Project-level analytics aggregation
4. Contributor activity metrics
5. Yield generation tracking

## Complexity Assessment

**Complexity: Trivial (100 points)** ✅

This feature is correctly classified as trivial because:
- Leverages existing storage infrastructure
- Simple arithmetic operations (addition/subtraction)
- No complex algorithms or data structures
- Minimal new code (3 public functions, ~50 lines)
- Comprehensive test coverage included
- No external dependencies
- No breaking changes to existing functionality

## Conclusion

This implementation provides a solid foundation for on-chain analytics with minimal overhead and maximum transparency. The trustless nature of the metrics makes them ideal for building user-facing dashboards, monitoring tools, and protocol governance systems.
