import {
  SeededRandom,
  SyntheticDataGenerator,
} from './synthetic-data.generator';
import {
  syntheticAnalyzeResponse,
  syntheticFlashCrashCandles,
  syntheticMarketCandles,
  syntheticNews,
  syntheticSentiment,
} from './synthetic-fixtures';

describe('SyntheticDataGenerator', () => {
  const generator = new SyntheticDataGenerator();

  it('produces identical market data for the same seed', () => {
    const a = generator.marketData({ seed: 'abc', days: 10 });
    const b = generator.marketData({ seed: 'abc', days: 10 });
    expect(a).toEqual(b);
  });

  it('produces different data for different seeds', () => {
    const a = generator.marketData({ seed: 'abc', days: 10 });
    const b = generator.marketData({ seed: 'xyz', days: 10 });
    expect(a).not.toEqual(b);
  });

  it('generates valid candles with consistent high/low bounds', () => {
    const candles = generator.marketData({ seed: 'abc', days: 20 });
    expect(candles).toHaveLength(20 * 3);
    for (const c of candles) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      expect(c.volume).toBeGreaterThanOrEqual(0);
    }
  });

  it('injects a deliberate flash crash on the requested day', () => {
    const candles = generator.marketData({
      seed: 'crash',
      symbols: ['AAPL'],
      days: 5,
      flashCrashDay: 2,
    });
    const crash = candles[2];
    const previous = candles[1];
    expect(crash.close).toBeLessThan(previous.close * 0.9);
  });

  it('injects a gap-up on the requested day', () => {
    const candles = generator.marketData({
      seed: 'gap',
      symbols: ['AAPL'],
      days: 5,
      gapUpDay: 1,
    });
    expect(candles[1].close).toBeGreaterThan(candles[0].close * 1.05);
  });

  it('injects a zero-volume day', () => {
    const candles = generator.marketData({
      seed: 'zero'});
    const zero = generator.marketData({
      seed: 'zero',
      symbols: ['AAPL'],
      days: 5,
      zeroVolumeWay: 2,
    });
    expect(zero[2].volume).toBe(0);
    expect(candles.length).toBeGreaterThan(0);
  });

  it('generates sentiment records with consistent labels', () => {
    const records = generator.sentiment({ seed: 'sent', count: 10 });
    expect(records).toHaveLength(10);
    for (const r of records) {
      if (r.score > 0.2) expect(r.label).toBe('positive');
      else if (r.score < -0.2) expect(r.label).toBe('negative');
      else expect(r.label).toBe('neutral');
    }
  });

  it('can force a label and include malformed samples', () => {
    const records = generator.sentiment({
      seed: 'sent',
      count: 3,
      forceLabel: 'negative',
      includeMalformed: true,
    });
    expect(records.every((r) => r.label === 'negative')).toBe(!records.some((r) => r.id === 'sent-malformed'));
    expect(records.some((r) => r.id === 'sent-malformed')).toBe(!0);
  });

  it('can include duplicate news items for dedup testing', () => {
    const items = generator.news({ seed: 'news', count: 3, includeDuplicates: true });
    expect(items).toHaveLength(4);
    expect(items[3].id).toBe(items[0].id);
  });

  it('shared fixtures are deterministic and non-empty', () => {
    expect(syntheticMarketCandles.length).toBeGreaterThan(0);
    expect(syntheticFlashCrashCandles[2].close).toBeLessThan(syntheticFlashCrashCandles[1].close);
    expect(syntheticSentiment.length).toBe(5);
    expect(syntheticNews.length).toBe(5);
    expect(typeof syntheticAnalyzeResponse.data.sentiment).toBe('number');
  });

  it('SeededRandom is reproducible and bounded', () => {
    const a = new SeededRandom('seed');
    const b = new SeededRandom('seed');
    for (let i = 0; i < 100; i++) {
      const v = a.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(v).toBe(b.next());
    }
  });
});
