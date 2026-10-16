"""Prediction audit export persistence tests."""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import pytest

from src.db.models import Base
from src.db.postgres_service import PostgresService


def _sqlite_service() -> PostgresService:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    service = PostgresService.__new__(PostgresService)
    service.database_url = "sqlite:///:memory:"
    service.engine = engine
    service.SessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
        bind=engine,
    )
    return service


def test_prediction_audit_export_returns_features_and_audits_subject_filter():
    service = _sqlite_service()
    assert service.log_prediction(
        request_id="req-audit-1",
        model_type="contribution_risk",
        model_version="v2.3",
        input_hash="hashed-input",
        output={"flagged": True},
        latency_ms=4.5,
        subject_hash="hashed-subject",
        feature_values={"amount": 1250, "account_age_days": 4},
    )

    rows = service.export_prediction_audit(
        export_id="export-audit-1",
        request_id="audit-request-1",
        subject_hash="hashed-subject",
    )

    assert len(rows) == 1
    assert rows[0]["request_id"] == "req-audit-1"
    assert rows[0]["model_version"] == "v2.3"
    assert rows[0]["input_hash"] == "hashed-input"
    assert rows[0]["feature_values"] == {
        "amount": 1250,
        "account_age_days": 4,
    }

    audit_events = service.query_prediction_audit_exports()
    assert len(audit_events) == 1
    assert audit_events[0]["export_id"] == "export-audit-1"
    assert audit_events[0]["request_id"] == "audit-request-1"
    assert audit_events[0]["filters"] == {"subject_hash": "hashed-subject"}
    assert audit_events[0]["exported_count"] == 1


def test_audit_entry_joins_exact_model_card_and_snapshot_metadata(monkeypatch):
    server = pytest.importorskip("src.api.server")
    monkeypatch.setattr(
        server,
        "load_metadata",
        lambda model_type, version: {
            "metrics": {"r2": 0.91},
            "data_query_bounds": {
                "snapshot_id": "training_march",
                "snapshot_hash": "snapshot-hash",
            },
        },
    )
    monkeypatch.setattr(
        server,
        "load_model_card",
        lambda model_type, version: {
            "model_type": model_type,
            "version": version,
            "feature_schema": {"version": "1.0"},
        },
    )

    entries = server._prediction_audit_entries(
        [
            {
                "prediction_id": "42",
                "request_id": "req-42",
                "model_type": "contribution_risk",
                "model_version": "v2.3",
                "input_hash": "input-hash",
                "feature_values": {"amount": 1250},
                "output": {"flagged": True},
                "created_at": "2026-03-01T12:00:00+00:00",
            }
        ]
    )

    assert entries[0]["model_card"]["version"] == "v2.3"
    assert entries[0]["model_metadata"]["metrics"] == {"r2": 0.91}
    assert entries[0]["training_snapshot"] == {
        "snapshot_id": "training_march",
        "snapshot_hash": "snapshot-hash",
    }
