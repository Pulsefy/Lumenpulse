# Vesting Wallet - Claimable Preview View Implementation

## Issue #318: Add Claimable Preview View

### Summary
Added a pure view method `get_claimable()` that returns how much a beneficiary could claim at the current time without modifying state. This allows frontends to display "claimable now" amounts without triggering transactions.

### Changes Made

#### 1. Helper Function (DRY Principle)
Created `calculate_claimable_amount()` as a private helper function that encapsulates the vesting calculation logic:
- Handles three scenarios:
  - Before vesting starts: returns 0
  - After vesting ends: returns all remaining tokens
  - During vesting: calculates linearly vested amount
- Uses safe arithmetic with `checked_mul` and `checked_div`
- Shared by all methods that need to calculate claimable amounts

#### 2. New Public Method: `get_claimable()`
```rust
pub fn get_claimable(env: Env, beneficiary: Address) -> Result<i128, VestingError>
```
- Pure view method (doesn't modify state)
- Returns the amount a beneficiary can claim at the current time
- Uses the shared helper function to ensure consistency
- Returns `VestingError::VestingNotFound` if no vesting exists for the beneficiary

#### 3. Refactored Existing Methods
Updated the following methods to use the shared helper function:
- `claim()` - Now uses `calculate_claimable_amount()` for consistency
- `get_available_amount()` - Now uses `calculate_claimable_amount()` for consistency

### Benefits

1. **No Logic Divergence**: All methods use the same calculation logic via the helper function
2. **Frontend-Friendly**: Frontends can query claimable amounts without gas costs or state changes
3. **Consistency**: `get_claimable()` always returns the same value as `claim()` would return at that moment
4. **Maintainability**: Single source of truth for vesting calculations

### Testing

Added comprehensive tests:
- `test_get_claimable_view_method()`: Tests the view method at various points in the vesting schedule
- `test_get_claimable_consistency_with_claim()`: Verifies that `get_claimable()` predicts the exact amount that `claim()` will return

All 19 tests pass successfully:
- 17 existing tests (unchanged, still passing)
- 2 new tests for `get_claimable()` functionality

### Usage Example

```rust
// Frontend can check claimable amount without triggering a transaction
let claimable = client.get_claimable(&beneficiary);

// Display to user: "You can claim X tokens now"

// When user clicks claim button, execute the actual claim
let claimed = client.claim(&beneficiary);

// claimed will equal the previously displayed claimable amount
assert_eq!(claimed, claimable);
```

### API Signature

```rust
/// Get the claimable amount for a beneficiary without modifying state
/// This is a pure view method that returns how much a beneficiary could claim at the current time
pub fn get_claimable(env: Env, beneficiary: Address) -> Result<i128, VestingError>
```

**Parameters:**
- `env`: Soroban environment
- `beneficiary`: Address of the beneficiary to check

**Returns:**
- `Ok(i128)`: The amount of tokens claimable at the current time
- `Err(VestingError::VestingNotFound)`: If no vesting schedule exists for the beneficiary

**Note:** The method signature uses `beneficiary` as the identifier (not `vesting_id`) because the current implementation stores one vesting schedule per beneficiary address.
