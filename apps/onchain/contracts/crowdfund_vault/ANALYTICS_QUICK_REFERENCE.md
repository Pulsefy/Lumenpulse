# Analytics API Quick Reference

## 📊 Available Functions

### Get Complete Stats
```rust
pub fn get_protocol_stats(env: Env) -> Result<ProtocolStats, CrowdfundError>
```
**Returns:** `ProtocolStats { tvl: i128, cumulative_volume: i128 }`  
**Use when:** You need both metrics  
**Gas:** Most efficient for both metrics

### Get TVL Only
```rust
pub fn get_tvl(env: Env) -> Result<i128, CrowdfundError>
```
**Returns:** Current Total Value Locked  
**Use when:** You only need TVL  
**Gas:** Slightly cheaper than getting both

### Get Volume Only
```rust
pub fn get_cumulative_volume(env: Env) -> Result<i128, CrowdfundError>
```
**Returns:** All-time cumulative funding volume  
**Use when:** You only need volume  
**Gas:** Slightly cheaper than getting both

## 📈 Metric Behaviors

| Metric | Increases On | Decreases On | Never Decreases |
|--------|-------------|--------------|-----------------|
| **TVL** | `deposit()` | `withdraw()`, `refund_contributors()`, `clawback_contribution()` | ❌ |
| **Volume** | `deposit()` | - | ✅ |

## 🔧 Usage Examples

### Basic Query
```rust
let client = CrowdfundVaultContractClient::new(&env, &contract_id);
let stats = client.get_protocol_stats();
println!("TVL: {}, Volume: {}", stats.tvl, stats.cumulative_volume);
```

### Individual Metrics
```rust
let tvl = client.get_tvl();
let volume = client.get_cumulative_volume();
```

### Dashboard
```rust
let stats = client.get_protocol_stats();
let utilization = (stats.cumulative_volume * 100) / stats.tvl;
```

### Health Check
```rust
let stats = client.get_protocol_stats();
let is_healthy = stats.tvl >= MIN_TVL && stats.cumulative_volume >= MIN_VOLUME;
```

## 🎯 Common Patterns

### Growth Rate
```rust
let current = client.get_protocol_stats();
let growth = ((current.tvl - previous_tvl) * 100) / previous_tvl;
```

### Risk Assessment
```rust
let tvl = client.get_tvl();
let risk = if tvl < 100_000 { "HIGH" } else { "LOW" };
```

### API Export
```rust
let stats = client.get_protocol_stats();
format!(r#"{{"tvl": {}, "volume": {}}}"#, stats.tvl, stats.cumulative_volume)
```

## ⚡ Performance Tips

1. **Use `get_protocol_stats()`** when you need both metrics (single storage read)
2. **Use individual getters** when you only need one metric
3. **Cache results** if querying frequently in the same transaction
4. **No events emitted** - query directly for latest data

## 🔒 Security Notes

- ✅ Trustless (all on-chain)
- ✅ Atomic updates
- ✅ No admin manipulation
- ✅ Immutable history (volume)
- ✅ Version-checked reads

## 📝 Error Handling

All functions return `Result<T, CrowdfundError>`:

```rust
match client.get_protocol_stats() {
    Ok(stats) => println!("TVL: {}", stats.tvl),
    Err(CrowdfundError::NotInitialized) => println!("Contract not initialized"),
    Err(CrowdfundError::UnsupportedStorageVersion) => println!("Version mismatch"),
    Err(e) => println!("Error: {:?}", e),
}
```

## 🧪 Testing

```bash
# Run analytics tests
cargo test get_protocol_stats
cargo test get_tvl
cargo test get_cumulative_volume
cargo test analytics
```

## 📚 Full Documentation

See `ANALYTICS_FEATURE.md` for complete documentation.
