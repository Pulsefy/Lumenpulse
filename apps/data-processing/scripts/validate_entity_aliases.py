#!/usr/bin/env python3
"""
validate_entity_aliases.py — Validate and inspect the entity alias registry.

The registry lives in ``config/entity_aliases.yaml`` and is the single place
contributors add new spellings of projects, assets and ecosystem terms. Run
this before opening a PR; it is also the CI gate for the file.

Usage
-----
# Validate (exit 0 on success, 1 on error)
python scripts/validate_entity_aliases.py

# Validate a specific file (e.g. a proposed registry)
python scripts/validate_entity_aliases.py --path /tmp/entity_aliases.yaml

# Treat style warnings as failures (what CI runs)
python scripts/validate_entity_aliases.py --strict

# Pretty-print every canonical entity and its aliases
python scripts/validate_entity_aliases.py --summary

# Show the entity one spelling resolves to
python scripts/validate_entity_aliases.py --resolve '$xlm'
python scripts/validate_entity_aliases.py --resolve 'stellar lumens'

# Show which entities a piece of text mentions
python scripts/validate_entity_aliases.py --text 'Lumens rallied after the SDF grant'

# Machine-readable output for CI / tooling
python scripts/validate_entity_aliases.py --json

Validation rules
----------------
1. YAML parses and has a ``version`` and an ``entities`` list.
2. Every entity has ``canonical_id``, ``entity_type`` and ``display_name``.
3. ``canonical_id`` values are unique (hard error).
4. No alias is claimed by two canonical entities (hard error) — the registry
   never silently resolves a collision.
5. Style warnings: ``canonical_id`` shape, known ``entity_type``, assets
   declaring an ``asset_code``, entities with no alias at all, and aliases too
   short to be matched in free text.

Exit codes
----------
0  registry is valid (warnings allowed unless --strict)
1  registry is invalid, unreadable, or --strict with warnings
"""

from __future__ import annotations

import argparse
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, PROJECT_ROOT)

from src.analytics.entity_alias_registry import (  # noqa: E402
    DEFAULT_REGISTRY_PATH,
    EntityAliasRegistry,
    EntityAliasRegistryError,
)


def _load(path: str) -> EntityAliasRegistry:
    """Load the registry, converting any failure into a clean error exit."""
    if not os.path.isfile(path):
        print(f"ERROR: registry file not found: {path}", file=sys.stderr)
        raise SystemExit(1)
    try:
        return EntityAliasRegistry.from_yaml(path)
    except ImportError:
        print(
            "ERROR: PyYAML is required to validate the registry "
            "(pip install pyyaml)",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    except EntityAliasRegistryError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
    except Exception as exc:  # noqa: BLE001 - surface YAML syntax errors plainly
        print(f"ERROR: could not parse {path}: {exc}", file=sys.stderr)
        raise SystemExit(1) from None


def _print_summary(registry: EntityAliasRegistry) -> None:
    by_type: dict = {}
    for entity in registry:
        by_type.setdefault(entity.entity_type, []).append(entity)

    for entity_type in sorted(by_type):
        print(f"\n{entity_type} ({len(by_type[entity_type])})")
        print("-" * (len(entity_type) + 8))
        for entity in by_type[entity_type]:
            code = f" [{entity.asset_code}]" if entity.asset_code else ""
            print(f"  {entity.canonical_id}{code} -> {entity.display_name}")
            print(f"      aliases: {', '.join(entity.terms)}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate and inspect the entity alias registry.",
    )
    parser.add_argument(
        "--path",
        default=DEFAULT_REGISTRY_PATH,
        help="registry YAML to validate (default: config/entity_aliases.yaml)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="exit non-zero when style warnings are present",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="print every canonical entity and its aliases",
    )
    parser.add_argument(
        "--resolve",
        metavar="TERM",
        help="show the canonical entity a single spelling resolves to",
    )
    parser.add_argument(
        "--text",
        metavar="TEXT",
        help="show the entities mentioned in a piece of text",
    )
    parser.add_argument("--json", action="store_true", help="emit JSON")
    args = parser.parse_args()

    registry = _load(args.path)
    warnings = registry.validate()

    if args.resolve:
        entity = registry.resolve(args.resolve)
        payload = {
            "term": args.resolve,
            "resolved": entity.to_dict() if entity else None,
            "surface_form": registry.surface_form(args.resolve),
        }
        if args.json:
            print(json.dumps(payload, indent=2))
        elif entity is None:
            print(f"{args.resolve!r} is not registered")
        else:
            print(
                f"{args.resolve!r} -> {entity.canonical_id} "
                f"({entity.display_name}), tagged as "
                f"{payload['surface_form']!r}"
            )
        return 0

    if args.text:
        mentions = registry.find_in_text(args.text)
        payload = [
            {
                "canonical_id": mention.canonical_id,
                "matched_text": mention.matched_text,
                "surface_form": mention.surface_form,
            }
            for mention in mentions
        ]
        if args.json:
            print(json.dumps(payload, indent=2))
        elif not payload:
            print("no registered entities found in text")
        else:
            for item in payload:
                print(
                    f"  {item['matched_text']!r} -> {item['canonical_id']} "
                    f"(tagged as {item['surface_form']!r})"
                )
        return 0

    if args.json:
        print(
            json.dumps(
                {
                    "path": args.path,
                    "valid": True,
                    "version": registry.version,
                    "entity_count": len(registry),
                    "alias_count": registry.alias_count,
                    "warnings": warnings,
                },
                indent=2,
            )
        )
    else:
        print(f"Registry:      {args.path}")
        print(f"Version:       {registry.version}")
        print(f"Entities:      {len(registry)}")
        print(f"Alias keys:    {registry.alias_count}")
        print("Hard errors:   none (canonical IDs and aliases are unique)")
        if warnings:
            print(f"\nWarnings ({len(warnings)}):")
            for warning in warnings:
                print(f"  - {warning}")
        else:
            print("Warnings:      none")

        if args.summary:
            _print_summary(registry)

    if warnings and args.strict:
        print(
            f"\nFAILED: {len(warnings)} warning(s) with --strict",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
