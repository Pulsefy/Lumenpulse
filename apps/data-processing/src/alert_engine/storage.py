from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class SuppressionRecord:
    dedup_key: str
    rule_name: str
    first_seen: str
    last_attempt: str
    emit_count: int
    suppress_count: int
    last_alert: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class SuppressionStore:
    def __init__(self, storage_path: Optional[str] = "./data/alert_suppression.json"):
        # If storage_path is None, operate purely in‑memory without persisting to disk.
        self.storage_path = Path(storage_path) if storage_path is not None else None
        if self.storage_path is not None:
            self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self._records: Dict[str, SuppressionRecord] = {}
        self._load()

    def _load(self) -> None:
        if self.storage_path.exists():
            try:
                with open(self.storage_path, "r") as f:
                    raw = json.load(f)
                for key, data in raw.items():
                    self._records[key] = SuppressionRecord(**data)
            except (json.JSONDecodeError, IOError):
                self._records = {}

    def _save(self) -> None:
        raw = {k: v.to_dict() for k, v in self._records.items()}
        with open(self.storage_path, "w") as f:
            json.dump(raw, f, indent=2)

    def get(self, dedup_key: str) -> Optional[SuppressionRecord]:
        return self._records.get(dedup_key)

    def record_emitted(self, dedup_key: str, rule_name: str, alert: Dict[str, Any]) -> SuppressionRecord:
        now = datetime.now(timezone.utc).isoformat()
        if dedup_key in self._records:
            rec = self._records[dedup_key]
            rec.emit_count += 1
            rec.last_attempt = now
            rec.last_alert = alert
        else:
            rec = SuppressionRecord(
                dedup_key=dedup_key,
                rule_name=rule_name,
                first_seen=now,
                last_attempt=now,
                emit_count=1,
                suppress_count=0,
                last_alert=alert,
            )
            self._records[dedup_key] = rec
        self._save()
        return rec

    def record_suppressed(self, dedup_key: str, rule_name: str, alert: Dict[str, Any]) -> SuppressionRecord:
        now = datetime.now(timezone.utc).isoformat()
        if dedup_key in self._records:
            rec = self._records[dedup_key]
            rec.suppress_count += 1
            rec.last_attempt = now
            rec.last_alert = alert
        else:
            rec = SuppressionRecord(
                dedup_key=dedup_key,
                rule_name=rule_name,
                first_seen=now,
                last_attempt=now,
                emit_count=0,
                suppress_count=1,
                last_alert=alert,
            )
            self._records[dedup_key] = rec
        self._save()
        return rec

    @property
    def records(self) -> Dict[str, SuppressionRecord]:
        return dict(self._records)

    def clear(self) -> None:
        self._records.clear()
        self._save()
