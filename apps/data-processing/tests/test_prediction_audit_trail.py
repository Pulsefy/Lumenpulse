"""
Tests for the prediction audit trail export (Issue #1639).

Covers:
  * AC1: assemble_audit_trail joins prediction log, registry metadata, model card.
  * AC2: queries by prediction_id, subject, and time_range.
  * AC3: personal data / raw_input privacy enforcement.
  * AC4: export runs are themselves logged.
  * AC5: worked example tested end-to-end.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from unittest.mock import MagicMock, patch, PropertyMock
import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

FAKE_PREDICTION_ROW: Dict[str, Any] = {
    "request_id": "req-abc-123",
    "model_type": "sentiment",
    "model_version": "v1.0",
    "input_hash": hashlib.sha256(b"XLM is rallying hard today").hexdigest(),
    "output": {
        "sentiment": 0.75,
        "asset_codes": ["XLM"],
        "sentiment_label": "positive",
    },
    "latency_ms": 42.1,
    "raw_input": "XLM is rallying hard today",
    "created_at": "2026-03-15T14:30:00+00:00",
}

FAKE_METADATA: Dict[str, Any] = {
    "model_type": "sentiment",
    "version": "v1.0",
    "saved_at": "2026-03-01T10:00:00",
    "schema_version": "1",
    "metrics": {"mse": 0.01, "r2": 0.95},
    "feature_names": ["sentiment_score", "volume", "volatility"],
}

FAKE_CARD_DICT: Dict[str, Any] = {
    "version": "v1.0",
    "model_type": "sentiment",
    "created_at": "2026-03-01T10:00:00+00:00",
    "schema_version": "1.0",
    "training_data": {
        "row_count": 5000,
        "data_start_date": "2026-01-01",
        "data_end_date": "2026-03-01",
        "source": "crypto_slang_lexicon",
        "description": None,
        "features": ["compound", "pos", "neg", "neu"],
    },
    "hyperparameters": {"params": {}, "tuning_notes": None},
    "metrics": {
        "accuracy": None,
        "precision": None,
        "recall": None,
        "f1_score": None,
        "auc": None,
        "mae": None,
        "rmse": None,
        "r2_score": None,
        "additional_metrics": {},
        "test_size": None,
        "validation_size": None,
    },
    "feature_schema": {
        "version": "1.0",
        "features": [{"name": "compound", "type": "float"}],
        "target": None,
        "description": None,
    },
    "source_code_commit": None,
    "training_script": None,
    "created_by": "retraining_pipeline",
    "custom": {},
}


# ---------------------------------------------------------------------------
# Unit tests: assemble_audit_trail
# ---------------------------------------------------------------------------

class TestAssembleAuditTrail:
    """Tests for src.ml.audit_trail.assemble_audit_trail."""

    def _call(self, row=None, include_raw=False, meta=FAKE_METADATA, card=FAKE_CARD_DICT):
        from src.ml.audit_trail import assemble_audit_trail

        row = row or dict(FAKE_PREDICTION_ROW)
        with (
            patch("src.ml.audit_trail.load_metadata", return_value=meta),
            patch("src.ml.audit_trail.load_model_card") as mock_card,
        ):
            if card is None:
                mock_card.return_value = None
            else:
                card_obj = MagicMock()
                card_obj.to_dict.return_value = card
                mock_card.return_value = card_obj

            return assemble_audit_trail(row, include_raw_input=include_raw)

    # AC1 ------------------------------------------------------------------

    def test_prediction_section_present(self):
        doc = self._call()
        assert doc["prediction"]["request_id"] == "req-abc-123"
        assert doc["prediction"]["model_type"] == "sentiment"
        assert doc["prediction"]["model_version"] == "v1.0"
        assert "input_hash" in doc["prediction"]
        assert "output" in doc["prediction"]
        assert "latency_ms" in doc["prediction"]
        assert "created_at" in doc["prediction"]

    def test_model_section_contains_registry_metadata(self):
        doc = self._call()
        assert doc["model"]["registry_metadata"] == FAKE_METADATA
        assert doc["model"]["model_version"] == "v1.0"

    def test_model_card_included_when_present(self):
        doc = self._call()
        assert doc["model_card"] is not None
        assert doc["model_card"]["version"] == "v1.0"
        assert doc["model_card"]["training_data"]["row_count"] == 5000

    def test_model_card_none_when_missing(self):
        doc = self._call(card=None)
        assert doc["model_card"] is None

    def test_assembled_at_is_iso(self):
        doc = self._call()
        # Should parse as ISO datetime without raising
        datetime.fromisoformat(doc["assembled_at"])

    def test_metadata_load_failure_is_non_fatal(self):
        """Registry metadata unavailable → model_section still present, metadata=None."""
        with (
            patch("src.ml.audit_trail.load_metadata", side_effect=FileNotFoundError),
            patch("src.ml.audit_trail.load_model_card", return_value=None),
        ):
            from src.ml.audit_trail import assemble_audit_trail
            doc = assemble_audit_trail(dict(FAKE_PREDICTION_ROW))
        assert doc["model"]["registry_metadata"] is None
        assert doc["prediction"]["request_id"] == "req-abc-123"

    # AC3 ------------------------------------------------------------------

    def test_raw_input_redacted_by_default(self):
        doc = self._call(include_raw=False)
        assert doc["prediction"]["raw_input"] == "[REDACTED]"
        assert doc["privacy"]["raw_input_included"] is False
        assert doc["privacy"]["raw_input_policy"] == "redacted_per_wave9_policy"

    def test_raw_input_included_when_policy_allows(self):
        with patch.dict(os.environ, {"LOG_PREDICTION_RAW_INPUT": "true"}):
            doc = self._call(include_raw=True)
        assert doc["prediction"]["raw_input"] == "XLM is rallying hard today"
        assert doc["privacy"]["raw_input_included"] is True
        assert doc["privacy"]["raw_input_policy"] == "included_scrubbed"

    def test_raw_input_still_redacted_when_env_false_even_if_caller_requests(self):
        with patch.dict(os.environ, {"LOG_PREDICTION_RAW_INPUT": "false"}):
            doc = self._call(include_raw=True)
        assert doc["prediction"]["raw_input"] == "[REDACTED]"

    def test_privacy_section_flags_output_scrubbing(self):
        doc = self._call()
        assert doc["privacy"]["output_scrubbed_at_log_time"] is True
        assert doc["privacy"]["input_hash_algorithm"] == "sha256_of_scrubbed_input"


# ---------------------------------------------------------------------------
# Unit tests: PostgresService audit-trail methods (SQLite in-memory)
# ---------------------------------------------------------------------------

class TestPostgresServiceAuditMethods:
    """Test the new DB service methods with a real in-memory SQLite database."""

    @pytest.fixture
    def svc(self, tmp_path):
        """Spin up a real SQLite-backed PostgresService for integration testing."""
        db_url = f"sqlite:///{tmp_path / 'test.db'}"
        os.environ["DATABASE_URL"] = db_url

        from src.db.postgres_service import PostgresService
        from src.db.models import Base, PredictionLog, AuditExportRun

        service = PostgresService()
        Base.metadata.create_all(service.engine)

        # Seed one prediction log row
        with service.get_session() as session:
            log = PredictionLog(
                request_id="req-abc-123",
                model_type="sentiment",
                model_version="v1.0",
                input_hash=hashlib.sha256(b"XLM is rallying").hexdigest(),
                output={"sentiment": 0.75, "asset_codes": ["XLM"], "sentiment_label": "positive"},
                latency_ms=38.5,
                raw_input="XLM is rallying",
            )
            session.add(log)
            session.commit()

        return service

    # AC2: by prediction_id

    def test_get_prediction_by_id_found(self, svc):
        row = svc.get_prediction_by_id("req-abc-123")
        assert row is not None
        assert row["request_id"] == "req-abc-123"
        assert row["model_type"] == "sentiment"
        assert row["model_version"] == "v1.0"

    def test_get_prediction_by_id_not_found(self, svc):
        row = svc.get_prediction_by_id("no-such-id")
        assert row is None

    # AC2: by subject

    def test_query_by_subject_match(self, svc):
        rows = svc.query_prediction_logs_by_subject(subject="XLM")
        assert len(rows) == 1
        assert rows[0]["request_id"] == "req-abc-123"

    def test_query_by_subject_no_match(self, svc):
        rows = svc.query_prediction_logs_by_subject(subject="DOGE")
        assert rows == []

    def test_query_by_subject_case_insensitive(self, svc):
        rows = svc.query_prediction_logs_by_subject(subject="xlm")
        assert len(rows) == 1

    # AC2: by time range

    def test_query_by_time_range_includes_record(self, svc):
        rows, total = svc.query_prediction_logs_by_time_range(
            start="2020-01-01T00:00:00Z",
            end="2040-01-01T00:00:00Z",
        )
        assert total == 1
        assert len(rows) == 1

    def test_query_by_time_range_excludes_record(self, svc):
        rows, total = svc.query_prediction_logs_by_time_range(
            start="2010-01-01T00:00:00Z",
            end="2015-01-01T00:00:00Z",
        )
        assert total == 0
        assert rows == []

    def test_query_by_time_range_invalid_dates_returns_empty(self, svc):
        rows, total = svc.query_prediction_logs_by_time_range(
            start="not-a-date",
            end="also-not-a-date",
        )
        assert rows == []
        assert total == 0

    # AC4: export run audit logging

    def test_log_audit_export_run_creates_row(self, svc):
        from src.db.models import AuditExportRun
        from sqlalchemy import select

        result = svc.log_audit_export_run(
            query_type="prediction_id",
            query_params={"request_id": "req-abc-123"},
            row_count=1,
            request_id="corr-xyz",
            client_ip="127.0.0.1",
        )
        assert result is True

        with svc.get_session() as session:
            runs = session.execute(
                select(AuditExportRun).where(AuditExportRun.query_type == "prediction_id")
            ).scalars().all()
        assert len(runs) == 1
        assert runs[0].row_count == 1
        assert runs[0].status == "ok"
        assert runs[0].client_ip == "127.0.0.1"

    def test_log_audit_export_run_records_error_status(self, svc):
        from src.db.models import AuditExportRun
        from sqlalchemy import select

        svc.log_audit_export_run(
            query_type="subject",
            query_params={"subject": "XLM"},
            row_count=0,
            status="error",
            error_detail="Test error",
        )

        with svc.get_session() as session:
            runs = session.execute(
                select(AuditExportRun).where(AuditExportRun.status == "error")
            ).scalars().all()
        assert len(runs) == 1
        assert runs[0].error_detail == "Test error"


# ---------------------------------------------------------------------------
# AC5: Worked example — "why did the system flag this contribution in March"
# ---------------------------------------------------------------------------

class TestWorkedExample:
    """
    End-to-end trace: a contribution flagged in March 2026 with asset_codes
    containing 'XLM'.  Tests that the audit trail correctly assembles all
    three data sources into a coherent answer.
    """

    FLAGGED_ROW: Dict[str, Any] = {
        "request_id": "req-march-flagged-001",
        "model_type": "sentiment",
        "model_version": "v2.3",
        "input_hash": hashlib.sha256(b"XLM project looking sus").hexdigest(),
        "output": {
            "sentiment": -0.62,
            "asset_codes": ["XLM"],
            "sentiment_label": "negative",
        },
        "latency_ms": 55.0,
        "raw_input": "XLM project looking sus",
        "created_at": "2026-03-15T09:00:00+00:00",
    }

    REGISTRY_META: Dict[str, Any] = {
        "model_type": "sentiment",
        "version": "v2.3",
        "saved_at": "2026-02-01T08:00:00",
        "schema_version": "2",
        "metrics": {"mse": 0.009, "r2": 0.97},
        "feature_names": ["sentiment_score", "volume", "volatility"],
        "training_schema_version": "2",
    }

    CARD: Dict[str, Any] = {
        "version": "v2.3",
        "model_type": "sentiment",
        "created_at": "2026-02-01T08:00:00+00:00",
        "schema_version": "1.0",
        "training_data": {
            "row_count": 12000,
            "data_start_date": "2025-11-01",
            "data_end_date": "2026-01-31",
            "source": "crypto_slang_lexicon_v2",
            "description": "Extended with DeFi / Soroban terms",
            "features": ["compound", "pos", "neg", "neu"],
        },
        "hyperparameters": {"params": {}, "tuning_notes": None},
        "metrics": {
            "accuracy": None, "precision": None, "recall": None, "f1_score": None,
            "auc": None, "mae": None, "rmse": None, "r2_score": None,
            "additional_metrics": {}, "test_size": None, "validation_size": None,
        },
        "feature_schema": {
            "version": "2.0",
            "features": [{"name": "compound", "type": "float"}],
            "target": None, "description": None,
        },
        "source_code_commit": "abc123def",
        "training_script": "retraining_pipeline.py",
        "created_by": "retraining_pipeline",
        "custom": {},
    }

    def test_full_audit_trail_assembly(self):
        from src.ml.audit_trail import assemble_audit_trail

        card_obj = MagicMock()
        card_obj.to_dict.return_value = self.CARD

        with (
            patch("src.ml.audit_trail.load_metadata", return_value=self.REGISTRY_META),
            patch("src.ml.audit_trail.load_model_card", return_value=card_obj),
        ):
            doc = assemble_audit_trail(self.FLAGGED_ROW)

        # The question: why did the system flag this contribution in March?

        # ── 1. Which prediction? ──────────────────────────────────────────
        assert doc["prediction"]["request_id"] == "req-march-flagged-001"
        assert doc["prediction"]["created_at"] == "2026-03-15T09:00:00+00:00"
        assert doc["prediction"]["output"]["sentiment_label"] == "negative"
        assert "XLM" in doc["prediction"]["output"]["asset_codes"]

        # ── 2. Which model version produced it? ───────────────────────────
        assert doc["model"]["model_version"] == "v2.3"
        assert doc["model"]["registry_metadata"]["schema_version"] == "2"

        # ── 3. What was the model trained on? ─────────────────────────────
        card = doc["model_card"]
        assert card is not None
        assert card["training_data"]["row_count"] == 12000
        assert card["training_data"]["data_end_date"] == "2026-01-31"
        assert "DeFi" in card["training_data"]["description"]

        # ── 4. Input hash traceable without exposing raw text ─────────────
        assert doc["prediction"]["input_hash"] == hashlib.sha256(
            b"XLM project looking sus"
        ).hexdigest()
        assert doc["prediction"]["raw_input"] == "[REDACTED]"  # policy default

        # ── 5. Privacy fields correct ──────────────────────────────────────
        assert doc["privacy"]["raw_input_included"] is False
        assert doc["privacy"]["input_hash_algorithm"] == "sha256_of_scrubbed_input"
        assert doc["privacy"]["output_scrubbed_at_log_time"] is True
