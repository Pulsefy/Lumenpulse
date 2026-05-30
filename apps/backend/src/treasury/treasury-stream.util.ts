/** Raw stream fields as decoded from the treasury contract's `StreamData`. */
export interface RawStreamData {
  beneficiary: string;
  totalAmount: bigint;
  claimedAmount: bigint;
  startTime: bigint;
  duration: bigint;
}

/**
 * Mirrors `TreasuryContract::calculate_unlocked` in
 * `apps/onchain/contracts/treasury/src/lib.rs`. Computes how much of a stream
 * is unlocked (and not yet claimed) at `currentTime` (Unix seconds).
 *
 * Kept in sync with the contract so read endpoints can report the claimable
 * amount without an extra simulation round-trip. All arithmetic uses bigint to
 * match the contract's i128/u64 semantics.
 */
export function calculateUnlocked(
  currentTime: bigint,
  stream: RawStreamData,
): bigint {
  const { totalAmount, claimedAmount, startTime, duration } = stream;

  if (currentTime < startTime) {
    return 0n;
  }

  if (currentTime >= startTime + duration) {
    return totalAmount - claimedAmount;
  }

  const timeElapsed = currentTime - startTime;
  const totalUnlocked = (totalAmount * timeElapsed) / duration;
  return totalUnlocked - claimedAmount;
}
