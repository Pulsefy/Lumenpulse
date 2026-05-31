/** Raw vesting fields as decoded from the vesting-wallet contract's `VestingData`. */
export interface RawVestingData {
  beneficiary: string;
  totalAmount: bigint;
  claimedAmount: bigint;
  startTime: bigint;
  duration: bigint;
}

/**
 * Mirrors `VestingWalletContract::calculate_claimable_amount` in
 * `apps/onchain/contracts/vesting-wallet/src/lib.rs`. Computes how much of a
 * vesting schedule is claimable at `currentTime` (Unix seconds).
 *
 * Kept in sync with the contract so read endpoints can report the claimable
 * amount without an extra simulation round-trip. All arithmetic uses bigint to
 * match the contract's i128 semantics.
 */
export function calculateClaimable(
  currentTime: bigint,
  vesting: RawVestingData,
): bigint {
  const { totalAmount, claimedAmount, startTime, duration } = vesting;

  if (currentTime < startTime) {
    return 0n;
  }

  if (currentTime >= startTime + duration) {
    return totalAmount - claimedAmount;
  }

  const timeElapsed = currentTime - startTime;
  const totalVested = (totalAmount * timeElapsed) / duration;
  return totalVested - claimedAmount;
}
