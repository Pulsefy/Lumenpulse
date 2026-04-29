# Treasury Streaming and Budget Allocation Module

This module implements time-based treasury streaming for approved budgets. It allows funds to unlock gradually over a specified duration instead of being released in one lump sum.

## Features

- **Budget Allocation**: Administrators can set aside a specific amount of tokens for a beneficiary.
- **Time-based Streaming**: Funds unlock linearly based on the elapsed time since the start of the stream.
- **Safe Claiming**: Beneficiaries can claim their currently unlocked tokens at any time.
- **Pure View Functions**: Check unlocked amounts without triggering transactions.

## How it works

1.  **Initialization**: The contract is initialized with an admin and a token address.
2.  **Allocation**: The admin calls `allocate_budget(beneficiary, amount, start_time, duration)`. This transfers tokens from the admin to the Treasury contract.
3.  **Streaming**: As time passes, the `get_unlocked` function returns an increasing amount of tokens available for the beneficiary.
4.  **Claiming**: The beneficiary calls `claim(beneficiary)` to receive the currently unlocked tokens.

## Integration with Crowdfund Vault

To use this module with the `crowdfund_vault`:
1.  Upon milestone approval in the `crowdfund_vault`, instead of the project owner calling `withdraw`, the admin or a designated automation can call `allocate_budget` on this contract.
2.  This ensures the project's budget is released gradually, incentivizing long-term progress.
