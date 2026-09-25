# Sentiment Score Explanations

This document describes the optional per-token **explanations** for sentiment
scores (Issue #1456) — how to request them, what they contain, the latency
overhead they add, and a worked example that traces a disputed score to its
cause so it can be investigated and the crypto-slang lexicon improved.

The feature is implemented in:

* `src/analytics/sentiment.py` — `analyze_text(text, lang_hint=None, *,
  explain=False)`, the primary analyzer used by ingestion.
* `src/sentiment.py` — `analyze(text, asset_filter=None, *, explain=False)`,
  the analyzer serving `POST /analyze`.
* `src/analytics/explanation.py` — shared contribution/explanation dataclasses
  and the leave-one-out (LOO) attribution helper.

## Enabling explanations

Explanations are **off by default**. Enable them explicitly:

| Entry point | Flag |
| --- | --- |
| `SentimentAnalyzer.analyze_text(...)` | `explain=True` |
| `sentiment.analyze(...)` (POST /analyze) | body `{"text": "...", "explain": true}` |

When disabled, scores are computed identically to before and no explanation is
attached (`explanation` is `null` in the `/analyze` response).

## Response shape

`analyze_text` returns a `SentimentScore` whose optional `explanation` (also a
`to_dict()`-able `SentimentExplanation`) carries:

| Field | Meaning |
| --- | --- |
| `method` | Scoring path used: `none`, `vader`, `vader+crypto_fallback`, `keyword:<lang>`, or `finbert`. |
| `score` | The score the contributions should reconstruct. |
| `model` | Model name, when the score came from a model (`finbert`). |
| `contributions` | One `FeatureContribution` per analyzed token. |
| `unattributed` | Residual after leave-one-out attribution (normalization noise; zero for linear paths). |

Each `FeatureContribution` references **exactly the lexicon entry or model
feature** responsible for the token's effect:

| `feature` | Meaning |
| --- | --- |
| `lexicon:vader:<word>` | The word's entry in the VADER sentiment lexicon. |
| `lexicon:vader:booster:<word>` | A VADER booster (`really`, `very`, ...). |
| `lexicon:crypto:positive:<word>` | A crypto-slang entry firing the fallback (`moon`, `pump`, ...). |
| `lexicon:crypto:negative:<word>` | A crypto-slang entry firing as negative (`bear`, `dump`, ...). |
| `keyword:<lang>:<token>` | A language keyword rule (es/pt). |
| `model:finbert:<token>` | The FinBERT feature (token) used for LOO attribution. |

Tokens that matched a lexicon/feature but were **not** scored (e.g. a positive
crypto-slang word shadowed by a higher-precedence negative entry) are still
listed with a `0.0` contribution and a `note` explaining why — this is exactly
the evidence needed to improve the slang lexicon.

## Latency overhead

Explanation work is gated behind `explain=True` and bounded. Where the score is
produced without iteration (VADER, crypto fallback, keyword rules) the
attribution is recomputed token-by-token with the same scorers, which adds no
second pass over external model inference:

| Scoring method (`explanation.method`) | Overhead when `explain=True` |
| --- | --- |
| `none` | None (`no extra work`). |
| `vader` / `vader+crypto_fallback` | At most one extra VADER pass per token — the same in-process lexical pass, truncated to the first `MAX_EXPLAIN_TOKENS` (20) tokens. |
| `keyword:<lang>` | Exact decomposition, `no extra scoring` required. |
| `finbert` | At most `MAX_EXPLAIN_TOKENS` (20) extra transformer forward passes, each truncated to 512 tokens. This is why the flag is off by default. |

The general-purpose `POST /analyze` (pure VADER, no transformer) therefore
never pays a model-inference cost when explaining. These overhead bounds are
exposed programmatically via `explanation_latency_overhead(method)` in
`src/analytics/explanation.py` and documented alongside the per-endpoint
budgets in `INFERENCE_LATENCY_BUDGET.md`.

## Worked example: tracing a disputed score

Reported: a post saying `"XLM mooning after a strong breakout"` scored higher
than expected, and the team suspects the crypto-slang lexicon inflated it.

Requesting an explanation (module level):

```python
from src.analytics.sentiment import SentimentAnalyzer

score = SentimentAnalyzer().analyze_text(
    "XLM mooning after a strong breakout", lang_hint="en", explain=True
)
print(score.compound_score)        # 0.5106
print(score.to_dict()["explanation"])
```

Produces:

```json
{
  "method": "vader",
  "score": 0.5106,
  "model": null,
  "contributions": [
    {"token": "strong", "contribution": 0.5106, "feature": "lexicon:vader:strong",
     "kind": "lexicon", "note": ""},
    {"token": "moon", "contribution": 0.0, "feature": "lexicon:crypto:positive:moon",
     "kind": "lexicon", "note": "matched but inactive: crypto fallback only applies when the VADER compound is exactly 0"}
  ],
  "unattributed": 0.0
}
```

The explanation attributes the entire score to **`lexicon:vader:strong`**
(+0.5106), while `moon` contributed **nothing**: the crypto fallback only fires
when the VADER compound is zero, and here it is not. The disputed polarity came
straight from VADER's own lexicon, not from the crypto-slang entry.

A complementary case — `"moon moon"` with `lang_hint="en"` — scores `0.4`
through `vader+crypto_fallback` and attributes it to
`lexicon:crypto:positive:moon`, and `"bearish moon"` scores `-0.4` with the
positive `moon` entry surfaced as inactive because negative entries take
precedence in the zero-compound fallback. Both are covered by the acceptance
tests in `tests/test_sentiment_explanation.py`.

## Troubleshooting a contributed score

To investigate a *different* disputed score:

1. Replay the exact text through `analyze_text(..., explain=True)` or
   `POST /analyze` with `"explain": true`.
2. Read the per-token `feature`/`contribution` list; the lexicon entry named by
   `feature` is the one responsible (`lexicon:vader:*`, `lexicon:crypto:*` are
   edited in the VADER lexicon and the crypto-slang table in
   `src/analytics/sentiment.py`).
3. If every significant contribution comes from a `lexicon:crypto:*` entry and
   the score still disagrees with reality, that entry is a candidate for
   removal or a polarity change in the slang table.

## Tests

`tests/test_sentiment_explanation.py` covers:

* off-by-default behaviour and opt-in flag;
* VADER, crypto-fallback (including inactive shadowed entries), negative
  precedence, es/pt keyword decompositions, FinBERT model features, unsupported
  and empty input;
* the score-reconstruction invariant and the documented latency-overhead bound;
* `POST /analyze` with/without `explain`, including attribution to a specific
  VADER lexicon entry.