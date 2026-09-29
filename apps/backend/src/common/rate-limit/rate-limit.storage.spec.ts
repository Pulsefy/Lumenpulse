import Keyv from 'keyv';
import { RateLimitEntry, RateLimitStorageService } from './rate-limit.storage';

describe('RateLimitStorageService', () => {
  let storage: RateLimitStorageService;
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    storage = new RateLimitStorageService(new Keyv<RateLimitEntry>());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const hit = () => storage.increment('k', 60_000, 2, 300_000, 'default');

  it('counts hits and blocks once the limit is exceeded', async () => {
    expect((await hit()).isBlocked).toBe(false);
    expect((await hit()).isBlocked).toBe(false);
    const blocked = await hit();
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.timeToBlockExpire).toBe(300);
  });

  it('honours a block that outlives the counting window', async () => {
    await hit();
    await hit();
    await hit(); // blocked for 300s, window is only 60s

    now += 120_000; // window elapsed, block still active
    const stillBlocked = await hit();
    expect(stillBlocked.isBlocked).toBe(true);
    expect(stillBlocked.timeToBlockExpire).toBe(180);
  });

  it('starts a fresh window once the block expires', async () => {
    await hit();
    await hit();
    await hit();

    now += 300_001;
    const afterBlock = await hit();
    expect(afterBlock.isBlocked).toBe(false);
    expect(afterBlock.totalHits).toBe(1);
  });
});
