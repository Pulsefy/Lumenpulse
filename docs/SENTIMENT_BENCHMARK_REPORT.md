# Sentiment benchmarking: VADER vs FinBERT

This report compares the legacy **VADER** compound score (with LumenPulse English crypto keyword hints) against **ProsusAI/finbert** scores used in `apps/data-processing/src/analytics/sentiment.py`.

## Method

- **VADER path**: `SentimentAnalyzer(enable_transformer=False)` → `_vader_english_compound(text)` (compound in \[-1, 1\]).
- **Transformer path**: FinBERT softmax over `{positive, negative, neutral}`; reported score is **P(positive) − P(negative)**, clipped to \[-1, 1\], matching the FinBERT label layout in the upstream [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert) config.
- **Test set**: Eight synthetic crypto-style English headlines (see `apps/data-processing/scripts/benchmark_sentiment_comparison.py`).

## How to reproduce

From `apps/data-processing`, with network access to Hugging Face Hub:

```bash
unset SENTIMENT_DISABLE_TRANSFORMER  # Windows: set SENTIMENT_DISABLE_TRANSFORMER=
python scripts/benchmark_sentiment_comparison.py
```

CI and default `pytest` runs set `SENTIMENT_DISABLE_TRANSFORMER=1` so unit tests avoid downloading model weights.

## Example run (representative)

Scores vary slightly with library versions; a typical local run looks like:

| Headline (abridged) | VADER compound | FinBERT P(pos)−P(neg) |
| ------------------- | -------------: | --------------------: |
| Bitcoin is crashing after regulators… | negative | strongly negative |
| Stellar hits all time high… | positive | positive |
| Ethereum plunges 12%… | negative | negative |
| Major bank launches crypto custody… | weak / neutral | positive |
| Token dump wipes $200M… | negative | negative |
| Spot ETF inflows reach record… | positive | positive |
| Bear market fears grow… | negative | negative |
| Stablecoin issuer attests full reserves… | weak positive | positive |

**Observation**: FinBERT tends to align with financial tone (e.g. “plunge”, “exploit”, “ETF inflows”) better than raw VADER on formal news phrasing, while VADER remains the **fallback** when transformers or weights are unavailable.

## Operational notes

- Override model with `SENTIMENT_TRANSFORMER_MODEL` (default `ProsusAI/finbert`).
- Force VADER-only with `SENTIMENT_DISABLE_TRANSFORMER=1`.
