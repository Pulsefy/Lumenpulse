# Timelock Admin Actions Implementation

## Overview

This implementation adds **timelock functionality** for high-impact admin operations across the StarkPulse smart contract ecosystem. Timelocks introduce a mandatory delay between the proposal and execution of sensitive actions, providing the community time to review and potentially cancel malicious or unintended changes.

## Background

Immediate privileged changes increase governance risk and reduce time for community review. The timelock module addresses this by:

- **Queuing sensitive operations** with configurable execution delays
- **Enabling inspection** of proposed actions before execution
- **Allowing cancellation** by the proposer or admin before execution
- **Emitting comprehensive events** with proposer, target action, and timestamp metadata

## Architecture

### Core Components

1. **Timelock Contract** (`contracts/timelock/`)
   - Standalone reusable timelock module
   - Manages proposal lifecycle (queue → wait → execute/cancel)
   - Configurable min/max delay parameters

2. **Integration Layer**
   - Project Registry: Timelock-aware admin functions
   - Treasury: Timelock-aware budget and configuration changes

### Data Flow

```
Admin Action Request
    ↓
Check if Timelock Enabled
    ↓
├─ Yes → Queue Action (emit event) → Wait Delay → Execute
└─ No  → Execute Immediately (emit event)
```

## Sensitive Actions Covered

### Project Registry
- `update_config` - Quorum threshold and voter weight changes (24h delay)
- `pause` - Contract pause (24h delay)
- `unpause` - Contract unpause (24h delay)
- `set_admin` - Admin role transfer (24h delay)
- `upgrade` - Contract WASM upgrade (48h delay - more critical)

### Treasury
- `allocate_budget` - Budget stream creation (24h delay)
- `set_token` - Treasury token destination change (24h delay)
- `set_admin` - Admin role transfer (24h delay)

## Usage

### 1. Deploy Timelock Contract

```rust
// Initialize timelock with 24h min delay and 7 day max delay
let timelock_address = timelock_client.initialize(
    &admin_address,
    86400,   // 24 hours in seconds
    604800,  // 7 days in seconds
);
```

### 2. Deploy Contracts with Timelock

```rust
// Project Registry with timelock
project_registry_client.initialize(
    &admin,
    quorum_threshold,
    weight_mode,
    governance_token,
    contributor_registry,
    min_voter_weight,
    Some(timelock_address),  // Enable timelock
);

// Treasury with timelock
treasury_client.initialize(
    &admin,
    &token_address,
    Some(timelock_address),  // Enable timelock
);
```

### 3. Queue an Admin Action

When timelock is enabled, calling admin functions automatically queues them:

```rust
// This will queue the action instead of executing immediately
let proposal_id = registry_client.update_config(
    &admin,
    new_quorum_threshold,
    new_min_voter_weight,
);

// Event emitted: AdminActionQueuedEvent {
//   admin,
//   action: "update_config",
//   proposal_id
// }
```

### 4. Inspect Queued Proposal

```rust
let proposal = timelock_client.get_proposal(&proposal_id);

// Returns:
// - proposer: Address
// - action_type: Symbol
// - target_contract: Address
// - payload: Vec<u8>
// - queued_at: u64
// - execute_at: u64
// - expires_at: u64
// - executed: bool
// - cancelled: bool
```

### 5. Execute After Delay

```rust
// Check if executable
if timelock_client.is_executable(&proposal_id) {
    // Execute the proposal
    let result = timelock_client.execute_proposal(&proposal_id);
}
```

### 6. Cancel Proposal (if needed)

```rust
// Can be called by original proposer or admin
timelock_client.cancel_proposal(&caller, &proposal_id);
```

## Events

All timelock operations emit detailed events for transparency:

### ActionQueuedEvent
```rust
{
    proposal_id: BytesN<32>,
    proposer: Address,
    action_type: Symbol,
    target_contract: Address,
    queued_at: u64,
    execute_at: u64,
}
```

### ActionExecutedEvent
```rust
{
    proposal_id: BytesN<32>,
    executed_at: u64,
    action_type: Symbol,
    target_contract: Address,
}
```

### ActionCancelledEvent
```rust
{
    proposal_id: BytesN<32>,
    cancelled_by: Address,
    cancelled_at: u64,
}
```

## Security Benefits

1. **Time for Review**: Community has 24-48 hours to review proposed changes
2. **Cancellation Capability**: Malicious proposals can be cancelled before execution
3. **Transparency**: All actions emit events with full metadata
4. **Graduated Delays**: More critical actions (upgrades) have longer delays
5. **Backward Compatible**: Contracts work with or without timelock enabled

## Configuration

### Delay Recommendations

| Action Type | Recommended Delay | Rationale |
|------------|-------------------|-----------|
| Config Updates | 24 hours | Standard governance review period |
| Pause/Unpause | 24 hours | Emergency but reviewable |
| Admin Transfer | 24 hours | Critical governance change |
| Contract Upgrade | 48 hours | Highest risk, needs extended review |
| Treasury Changes | 24 hours | Financial impact requires review |

### Min/Max Delay Settings

- **min_delay**: 86400 seconds (24 hours) - prevents rushed decisions
- **max_delay**: 604800 seconds (7 days) - prevents proposal expiration gaming

## Testing

Run the timelock test suite:

```bash
cd contracts/timelock
cargo test
```

Test coverage includes:
- Initialization validation
- Proposal queueing with delay validation
- Execution after delay elapsed
- Cancellation by proposer/admin
- Event emission verification
- Edge cases (expired proposals, double execution, etc.)

## Migration Path

For existing deployments:

1. Deploy timelock contract
2. Update admin procedures to queue actions
3. Optionally upgrade contracts with timelock integration
4. Community monitors queued actions via events
5. Execute proposals after delay period

## Future Enhancements

- Multi-sig integration for proposal execution
- Governance voting on proposals
- Variable delays based on action criticality
- Proposal metadata for better human readability
- Automatic execution after delay (requires off-chain keeper)

## API Reference

### Timelock Contract Functions

| Function | Description | Access |
|----------|-------------|--------|
| `initialize` | Setup timelock config | Admin (once) |
| `queue_action` | Queue action for delayed execution | Admin |
| `execute_proposal` | Execute queued proposal after delay | Anyone |
| `cancel_proposal` | Cancel queued proposal | Proposer or Admin |
| `get_proposal` | Get proposal details | Public |
| `is_executable` | Check if proposal ready | Public |
| `update_config` | Update delay parameters | Admin |
| `set_admin` | Transfer admin role | Admin |

### Error Codes

| Code | Error | Description |
|------|-------|-------------|
| 100 | AlreadyInitialized | Contract already initialized |
| 101 | NotInitialized | Contract not initialized |
| 102 | Unauthorized | Caller not authorized |
| 103 | InvalidDelay | Invalid delay configuration |
| 104 | DelayTooShort | Delay below minimum |
| 105 | DelayTooLong | Delay above maximum |
| 106 | ProposalAlreadyExists | Duplicate proposal |
| 107 | ProposalNotFound | Proposal doesn't exist |
| 108 | AlreadyExecuted | Proposal already executed |
| 109 | ProposalCancelled | Proposal was cancelled |
| 110 | DelayNotElapsed | Waiting period not over |
| 111 | ProposalExpired | Proposal expired |

## Contributing

When adding timelock support to new contracts:

1. Add `TimelockContract` to `DataKey` enum
2. Add `timelock_contract: Option<Address>` to `initialize()`
3. Implement `is_timelock_enabled()`, `get_timelock_contract()`, `queue_timelocked_action()`
4. Update sensitive admin functions to check timelock and queue if enabled
5. Add appropriate events for queued actions
6. Write tests covering both timelock and non-timelock paths

## License

This implementation is part of the StarkPulse project and follows the project's licensing terms.
