import { Test, TestingModule } from '@nestjs/testing';
import { TreasuryService } from './treasury.service';
import { TreasurySorobanClient } from './treasury-soroban.client';
import { TreasuryStreamNotFoundException } from './exceptions/treasury.exceptions';
import type { RawStreamData } from './treasury-stream.util';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const START_SECS = 1_735_689_600;
const DURATION_SECS = 2_592_000; // 30 days

const baseStream: RawStreamData = {
  beneficiary: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  totalAmount: BigInt(1_000_000_000),
  claimedAmount: BigInt(0),
  startTime: BigInt(START_SECS),
  duration: BigInt(DURATION_SECS),
};

// ── Mock client ───────────────────────────────────────────────────────────────

const mockGetStream = jest.fn();

const mockSorobanClient = {
  getStream: mockGetStream,
  allocateBudget: jest.fn(),
  rotateBeneficiary: jest.fn(),
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('TreasuryService.previewStream', () => {
  let service: TreasuryService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TreasuryService,
        { provide: TreasurySorobanClient, useValue: mockSorobanClient },
      ],
    }).compile();

    service = module.get<TreasuryService>(TreasuryService);
  });

  it('returns unlocked, claimed, and remaining for an active stream', async () => {
    mockGetStream.mockResolvedValue(baseStream);

    // At halfway through the 30-day stream: 50% unlocked = 500_000_000
    const halfwayPoint = START_SECS + DURATION_SECS / 2;

    const result = await service.previewStream({
      beneficiary: baseStream.beneficiary,
      atTime: halfwayPoint,
    });

    expect(result.beneficiary).toBe(baseStream.beneficiary);
    expect(result.totalAmount).toBe('1000000000');
    expect(result.claimedAmount).toBe('0');
    expect(result.unlockedAmount).toBe('500000000');
    expect(result.remainingAmount).toBe('1000000000');
    expect(result.previewAt).toBe(halfwayPoint);
    expect(result.isActive).toBe(true);
  });

  it('returns full remaining amount when stream has fully elapsed', async () => {
    const fullyClaimed: RawStreamData = {
      ...baseStream,
      claimedAmount: BigInt(250_000_000),
    };
    mockGetStream.mockResolvedValue(fullyClaimed);

    const afterEnd = START_SECS + DURATION_SECS + 1000;

    const result = await service.previewStream({
      beneficiary: baseStream.beneficiary,
      atTime: afterEnd,
    });

    expect(result.unlockedAmount).toBe('750000000');
    expect(result.remainingAmount).toBe('750000000');
    expect(result.isActive).toBe(false);
  });

  it('returns zero unlocked before stream starts', async () => {
    mockGetStream.mockResolvedValue(baseStream);

    const beforeStart = START_SECS - 1;

    const result = await service.previewStream({
      beneficiary: baseStream.beneficiary,
      atTime: beforeStart,
    });

    expect(result.unlockedAmount).toBe('0');
    expect(result.isActive).toBe(false);
  });

  it('defaults previewAt to current server time when atTime is omitted', async () => {
    mockGetStream.mockResolvedValue(baseStream);

    const before = Math.floor(Date.now() / 1000);
    const result = await service.previewStream({
      beneficiary: baseStream.beneficiary,
    });
    const after = Math.floor(Date.now() / 1000);

    expect(result.previewAt).toBeGreaterThanOrEqual(before);
    expect(result.previewAt).toBeLessThanOrEqual(after);
  });

  it('throws TreasuryStreamNotFoundException when stream is not found', async () => {
    mockGetStream.mockResolvedValue(null);

    await expect(
      service.previewStream({ beneficiary: 'GNOBODY' }),
    ).rejects.toThrow(TreasuryStreamNotFoundException);
  });

  it('matches contract math: unlocked = (total * elapsed) / duration - claimed', async () => {
    const partial: RawStreamData = {
      ...baseStream,
      claimedAmount: BigInt(100_000_000),
    };
    mockGetStream.mockResolvedValue(partial);

    // 25% through the stream
    const quarterPoint = START_SECS + DURATION_SECS / 4;

    const result = await service.previewStream({
      beneficiary: baseStream.beneficiary,
      atTime: quarterPoint,
    });

    // (1_000_000_000 * 25%) - 100_000_000 = 250_000_000 - 100_000_000 = 150_000_000
    expect(result.unlockedAmount).toBe('150000000');
    expect(result.remainingAmount).toBe('900000000');
  });
});
