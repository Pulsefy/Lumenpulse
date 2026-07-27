# Round Lifecycle Invariants — `crowdfund_vault` & `matching_pool`

This document is the single source of truth for the state-machine and
funds-conservation invariants that the round/project lifecycle test suites
enforce in:

- `crowdfund_vault/src/tests/round_lifecycle.rs`
- `matching_pool/src/tests/invariants.rs`

Both contracts implement a distinct concrete state machine, but they follow
the same shape — **open → contribute → finalize → refund/close** — and are
expected to uphold the same class of invariants. Keeping the description
here (rather than duplicated per-file) means a contributor only has to
learn the vocabulary once, and a fix to one contract's suite can be checked
against the same list for the other.

## Lifecycle mapping

| Phase        | `crowdfund_vault` (per project)                          | `matching_pool` (per round)              |
|--------------|-----------------------------------------------------------|-------------------------------------------|
| open         | `create_project`                                           | `create_round`                             |
| contribute   | `deposit`                                                   | `record_contribution` (+ `fund_pool`)      |
| finalize     | `approve_milestone` → `withdraw`                            | `finalize_round`                           |
| close-style  | `distribute_match` (quadratic match payout)                 | `distribute_matching_funds` (QF payout)    |
| refund       | `cancel_project` → `refund_contributors` / `clawback_contribution` | *(no direct equivalent; a round that never finalizes has no payout path)* |

## Shared invariants

Each invariant below is tagged `INV-<n>` and referenced by that tag in the
test code and test names so a failing test can be traced back to exactly
one rule.

1. **INV-1 State-machine monotonicity.** A round/project only moves forward
   through its states (`ACTIVE → FINALIZED → DISTRIBUTED` for a round;
   `ACTIVE → CANCELED/EXPIRED` for a project). No operation may move state
   backward, and no operation may re-enter a state it already left
   (e.g. `finalize_round` twice, `distribute_matching_funds` twice,
   `refund_contributors` after the contributor list has been drained).

2. **INV-2 Contribution window enforcement.** Contributions
   (`deposit` / `record_contribution`) must only succeed while the
   round/project is open: before `finalize_round`/`cancel_project`, and —
   for rounds — only inside `[start_time, end_time]`.

3. **INV-3 Conservation of funds.** Tokens are never created or destroyed by
   the contracts. At every step, `pool_or_project_balance_after ==
   pool_or_project_balance_before ± amount_moved`. Distribution never pays
   out more than was held (`distributed <= pool_before`,
   `sum(match payouts) <= matching pool balance`).

4. **INV-4 No double payout.** A given unit of value is claimable/payable
   exactly once: `refund_contributors`/`clawback_contribution` cannot pay a
   contributor twice, and `distribute_matching_funds` cannot distribute the
   same round's pool twice (`MatchAlreadyDistributed` / pool zeroed after
   distribution).

5. **INV-5 Authorization.** State-changing admin operations
   (`create_round`, `finalize_round`, `distribute_matching_funds`,
   `approve_milestone`, `fund_matching_pool`, `pause`) reject non-admin
   callers with the contract's `Unauthorized` error and never mutate state
   on rejection.

6. **INV-6 Pause halts state transitions.** While a contract is paused, no
   operation that would move a round/project through the lifecycle may
   succeed (deposits, contributions, round creation, finalization).

7. **INV-7 Non-existent target is rejected, not silently defaulted.**
   Operating on a round/project id that was never created returns
   `RoundNotFound` / `ProjectNotFound`; it must never be treated as valid
   with zeroed defaults.

8. **INV-8 Round contribution cap enforcement** (`matching_pool` only,
   introduced for #867's anti-whale guardrails). When a round's
   contribution cap (`RoundCap`, set via `set_round_cap`) is non-zero, a
   contributor's cumulative recorded contributions to that round — summed
   across every project in the round, via
   `get_contributor_round_total(round_id, contributor)` — must never
   exceed the cap. Any `record_contribution` call that would push the
   cumulative total over the cap is rejected in full
   (`ContributionCapExceeded`), with no partial acceptance and no state
   mutation. A cap of `0` means uncapped. Setting or changing a cap only
   affects future contributions — it never claws back or invalidates
   contributions already recorded — and `set_round_cap` itself is subject
   to `INV-5` (admin-only) and rejected once the round is finalized.

## Debugging a failing invariant

- Tests use `proptest`; on failure it prints the *minimal* shrunk input in
  the panic message plus a `proptest-regressions/<file>.txt` entry. Re-run
  the single test (`cargo test <test_name>`) — the regression file pins the
  same input deterministically.
- Every `prop_assert!`/`prop_assert_eq!` in these suites carries a message
  naming the `INV-<n>` it checks and the concrete before/after values, so
  the panic output alone should identify which rule broke and with what
  numbers, without needing to step through the test in a debugger.
- Each test module is named after the phase it stresses
  (`open_phase`, `contribute_phase`, `finalize_phase`, `refund_phase`,
  `close_phase`, `cap_phase`) so a failing module name narrows down which
  lifecycle transition (or guardrail) regressed.
