#!/usr/bin/env python3
"""
Training script: build SentimentForecaster from analytics.jsonl history
and optionally save the trained model to the model registry.

Usage:
    # Dry run — print forecast JSON to stdout
    python scripts/train_forecaster.py

    # Use a custom history file
    python scripts/train_forecaster.py --jsonl data/analytics.jsonl

    # Train and persist to model registry
    python scripts/train_forecaster.py --save

    # Write results to a file instead of stdout
    python scripts/train_forecaster.py --save --output /tmp/forecast.json
"""

import argparse
import json
import sys
from pathlib import Path

# Ensure the project root (apps/data-processing) is on sys.path so that
# ``src.*`` imports resolve correctly regardless of the working directory.
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.analytics.forecaster import SentimentForecaster  # noqa: E402
from src.utils.logger import setup_logger  # noqa: E402

logger = setup_logger("train_forecaster")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train SentimentForecaster from analytics.jsonl history"
    )
    parser.add_argument(
        "--jsonl",
        default=str(_PROJECT_ROOT / "data" / "analytics.jsonl"),
        help="Path to analytics.jsonl history file",
    )
    parser.add_argument(
        "--save",
        action="store_true",
        help="Persist trained model to model registry after training",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Write forecast JSON to this path instead of stdout",
    )
    args = parser.parse_args()

    jsonl_path = Path(args.jsonl)
    logger.info(f"Loading analytics history from {jsonl_path}")

    forecaster = SentimentForecaster(jsonl_path=jsonl_path)
    df = forecaster.load_history()

    if df.empty:
        logger.error(
            "No data loaded — ensure analytics.jsonl exists and contains valid entries"
        )
        sys.exit(1)

    logger.info(f"Loaded {len(df)} data point(s)")
    logger.info(
        f"Date range: {df['timestamp'].min().isoformat()} → "
        f"{df['timestamp'].max().isoformat()}"
    )

    # ── Train ──────────────────────────────────────────────────────────────
    metrics = forecaster.train(df)
    logger.info(f"Training complete: {metrics}")

    # ── Sentiment velocity ─────────────────────────────────────────────────
    velocity = SentimentForecaster.compute_sentiment_velocity(df)
    direction = "accelerating bullish" if velocity > 0 else "turning bearish" if velocity < 0 else "flat"
    logger.info(f"Sentiment velocity: {velocity:+.6f} per hour ({direction})")

    # ── Predict ────────────────────────────────────────────────────────────
    result = forecaster.predict(df)

    logger.info(
        f"Forecast 24 h: {result.predicted_trend_24h.upper()} "
        f"(score={result.forecast_score_24h:+.4f}, confidence={result.confidence_24h:.0%})"
    )
    logger.info(
        f"Forecast 48 h: {result.predicted_trend_48h.upper()} "
        f"(score={result.forecast_score_48h:+.4f}, confidence={result.confidence_48h:.0%})"
    )

    # ── Assemble output ────────────────────────────────────────────────────
    output: dict = {
        "training_metrics": metrics,
        "data_points": len(df),
        "date_range": {
            "start": df["timestamp"].min().isoformat(),
            "end": df["timestamp"].max().isoformat(),
        },
        "forecast": result.to_dict(),
    }

    # ── Optionally persist ─────────────────────────────────────────────────
    if args.save:
        version = forecaster.save()
        output["saved_version"] = version
        logger.info(f"Model saved as version {version}")

    # ── Emit results ───────────────────────────────────────────────────────
    output_json = json.dumps(output, indent=2, default=str)
    if args.output:
        Path(args.output).write_text(output_json)
        logger.info(f"Results written to {args.output}")
    else:
        print(output_json)


if __name__ == "__main__":
    main()
