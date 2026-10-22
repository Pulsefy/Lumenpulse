import {
  MarketCandle,
  SyntheticDataGenerator,
} from './synthetic-data.generator';

/**
 * Shared deterministic fixtures built on top of the synthetic generator.
 * Tests should import these instead of committing captured real payloads.
 */

const generator = new SyntheticDataGenerator();

export const SYNTHETIC_SEED = 'data-processing-tests';

export const syntheticMarketCandles: MarketCandle[] =
  generator.marketData({
    seed: SYNTHETIC_SEED,
    symbols: ['AAPL'],
    days: 5,
  });

export const syntheticFlashCrashCandles: MarketCandle[] =
  generator.marketData({
    seed: `${SYNTHETIC_SEED}-crash`,
    symbols: ['AAPL'],
    days: 5,
    flashCrashDay: 2,
  });

export const syntheticSentiment = generator.sentiment({
  seed: SYNTHETIC_SEED,
  count: 5,
});

export const syntheticNews = generator.news({
  seed: SYNTHETIC_SEED,
  count: 5,
});

export const syntheticAnalyzeResponse = {
  data: {
    sentiment: syntheticSentiment[0].score,
    label: syntheticSentiment[0].label,
  },
};
