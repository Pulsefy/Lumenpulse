"""Roll back a live model without retraining or re-registering it."""

import argparse
import json

from src.ml.model_registry import get_current_version, rollback_model


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model_type", help="Registered model type")
    parser.add_argument("--target-version", help="Saved version to make live")
    parser.add_argument("--actor", required=True, help="Operator performing rollback")
    parser.add_argument("--reason", required=True, help="Why rollback is required")
    args = parser.parse_args()

    from_version = get_current_version(args.model_type)
    to_version = rollback_model(
        args.model_type,
        args.target_version,
        actor=args.actor,
        reason=args.reason,
    )
    print(json.dumps({
        "status": "rolled_back",
        "model_type": args.model_type,
        "from_version": from_version,
        "to_version": to_version,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())