"""Replay historical records through two transforms and report regressions."""

import importlib
from dataclasses import dataclass
import json
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple


Transform = Callable[[Dict[str, Any]], Any]


@dataclass(frozen=True)
class Difference:
    """A single output difference for one historical record."""

    record_key: str
    path: str
    old_value: Any
    new_value: Any

    def to_dict(self) -> Dict[str, Any]:
        return {
            "record_key": self.record_key,
            "path": self.path,
            "old": self.old_value,
            "new": self.new_value,
        }


def load_records(path: str) -> List[Dict[str, Any]]:
    """Load a JSON array or JSONL file of historical object records."""
    with open(path, "r", encoding="utf-8-sig") as handle:
        content = handle.read().strip()

    if not content:
        return []
    parsed = json.loads(content) if content.startswith("[") else [
        json.loads(line) for line in content.splitlines() if line.strip()
    ]
    if not isinstance(parsed, list) or not all(isinstance(item, dict) for item in parsed):
        raise ValueError("Replay input must contain a JSON array or JSONL objects")
    return parsed


def select_records(
    records: Iterable[Dict[str, Any]],
    limit: Optional[int] = None,
    start_ledger: Optional[int] = None,
    end_ledger: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Select a bounded, stable sample, optionally constrained by ledger."""
    selected = []
    for record in records:
        ledger = record.get("ledger")
        if start_ledger is not None or end_ledger is not None:
            if not isinstance(ledger, int):
                continue
            if start_ledger is not None and ledger < start_ledger:
                continue
            if end_ledger is not None and ledger > end_ledger:
                continue
        selected.append(record)
        if limit is not None and len(selected) >= limit:
            break
    return selected


def _diff_values(old: Any, new: Any, path: str = "$") -> List[Tuple[str, Any, Any]]:
    if isinstance(old, dict) and isinstance(new, dict):
        differences = []
        for key in sorted(set(old) | set(new)):
            differences.extend(_diff_values(old.get(key), new.get(key), f"{path}.{key}"))
        return differences
    if isinstance(old, list) and isinstance(new, list):
        differences = []
        for index in range(max(len(old), len(new))):
            differences.extend(
                _diff_values(
                    old[index] if index < len(old) else None,
                    new[index] if index < len(new) else None,
                    f"{path}[{index}]",
                )
            )
        return differences
    return [] if old == new else [(path, old, new)]


def replay(
    records: Sequence[Dict[str, Any]],
    old_transform: Transform,
    new_transform: Transform,
) -> Dict[str, Any]:
    """Run both transforms and return a JSON-serializable validation report."""
    differences: List[Difference] = []
    failures: List[Dict[str, str]] = []
    compared = 0

    for index, record in enumerate(records):
        record_key = str(record.get("id", record.get("ledger", index)))
        try:
            old_output = old_transform(record)
            new_output = new_transform(record)
            compared += 1
            differences.extend(
                Difference(record_key, path, old, new)
                for path, old, new in _diff_values(old_output, new_output)
            )
        except Exception as exc:
            failures.append({"record_key": record_key, "error": str(exc)})

    return {
        "status": "failed" if failures else ("differences" if differences else "match"),
        "records": len(records),
        "compared": compared,
        "difference_count": len(differences),
        "failure_count": len(failures),
        "differences": [difference.to_dict() for difference in differences],
        "failures": failures,
    }


def import_transform(spec: str) -> Transform:
    """Load a transform using ``package.module:function`` notation."""
    module_name, separator, function_name = spec.partition(":")
    if not separator or not module_name or not function_name:
        raise ValueError(f"Transform must use module:function notation: {spec}")
    transform = getattr(importlib.import_module(module_name), function_name)
    if not callable(transform):
        raise TypeError(f"Transform is not callable: {spec}")
    return transform


def identity(record: Dict[str, Any]) -> Dict[str, Any]:
    """Default transform for smoke-checking a replay dataset."""
    return record