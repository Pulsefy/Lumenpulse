#!/usr/bin/env python3
"""
Compare VADER vs FinBERT (ProsusAI/finbert) on a small crypto news test set.

Usage (from apps/data-processing):
  python scripts/benchmark_sentiment_comparison.py

Unset SENTIMENT_DISABLE_TRANSFORMER to allow model download from Hugging Face.
"""

from __future__ import annotations

import os
import sys

# Repo layout: apps/data-processing/scripts -> src is ../src
_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# Allow FinBERT unless explicitly disabled in the shell
os.environ.pop("SENTIMENT_DISABLE_TRANSFORMER", None)

from src.analytics.sentiment import benchmark_vader_vs_transformer  # noqa: E402

CRYPTO_HEADLINES = (
    "Bitcoin is crashing after regulators announce a probe into major exchanges",
    "Stellar hits all time high as institutional adoption accelerates",
    "Ethereum plunges 12% amid macro uncertainty and heavy selling",
    "Major bank launches crypto custody; analysts see bullish structure",
    "Token dump wipes $200M from DeFi protocol in suspected exploit",
    "Spot ETF inflows reach record as retail sentiment turns positive",
    "Bear market fears grow as volume collapses and funding rates flip negative",
    "Stablecoin issuer attests full reserves; markets breathe a sigh of relief",
)


def main() -> None:
    rows, summary = benchmark_vader_vs_transformer(CRYPTO_HEADLINES)
    print("text\tvader_compound\tfinbert_p_pos_minus_p_neg")
    for text, (v, tf) in rows.items():
        tf_s = f"{tf:.4f}" if tf is not None else "n/a"
        print(f"{text[:80]!r}\t{v:.4f}\t{tf_s}")
    print("\nSummary:", summary)


if __name__ == "__main__":
    main()
