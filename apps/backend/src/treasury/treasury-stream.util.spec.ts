import { calculateUnlocked, RawStreamData } from './treasury-stream.util';

const baseStream: RawStreamData = {
  beneficiary: 'GBENEFICIARY',
  totalAmount: 1_000_000n,
  claimedAmount: 0n,
  startTime: 1_000n,
  duration: 100n,
};

describe('calculateUnlocked', () => {
  it('returns 0 before the stream starts', () => {
    expect(calculateUnlocked(999n, baseStream)).toBe(0n);
  });

  it('unlocks the full remaining amount at or after the end', () => {
    expect(calculateUnlocked(1_100n, baseStream)).toBe(1_000_000n);
    expect(calculateUnlocked(5_000n, baseStream)).toBe(1_000_000n);
  });

  it('unlocks linearly during the stream', () => {
    // 50% elapsed -> 500_000 unlocked
    expect(calculateUnlocked(1_050n, baseStream)).toBe(500_000n);
    // 25% elapsed -> 250_000 unlocked
    expect(calculateUnlocked(1_025n, baseStream)).toBe(250_000n);
  });

  it('subtracts already-claimed amounts', () => {
    const partlyClaimed: RawStreamData = {
      ...baseStream,
      claimedAmount: 200_000n,
    };
    // 50% unlocked (500_000) minus 200_000 already claimed
    expect(calculateUnlocked(1_050n, partlyClaimed)).toBe(300_000n);
  });

  it('returns remaining (total - claimed) once fully vested', () => {
    const partlyClaimed: RawStreamData = {
      ...baseStream,
      claimedAmount: 400_000n,
    };
    expect(calculateUnlocked(1_100n, partlyClaimed)).toBe(600_000n);
  });

  it('matches the contract integer-division (floor) semantics', () => {
    const stream: RawStreamData = {
      ...baseStream,
      totalAmount: 10n,
      duration: 3n,
    };
    // 1/3 elapsed -> floor(10 * 1 / 3) = 3
    expect(calculateUnlocked(1_001n, stream)).toBe(3n);
  });
});
