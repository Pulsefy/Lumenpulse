import pytest
import io
import json
import logging
from prometheus_client import REGISTRY

import sys
import os

# Add src to python path for imports
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "src"))

from src.utils.logger import setup_logger, correlation_id_ctx, CorrelationIdFilter
from src.utils.metrics import JOBS_RUN_TOTAL, API_FAILURES_TOTAL, ANOMALIES_DETECTED_TOTAL

def test_json_formatter_output():
    # Setup our custom logger
    test_logger = setup_logger("test_json", level=logging.INFO)
    correlation_id_ctx.set("test-json-123")
    
    # Capture the output
    from pythonjsonlogger import jsonlogger
    log_capture = io.StringIO()
    handler = logging.StreamHandler(log_capture)
    formatter = jsonlogger.JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(correlation_id)s %(message)s",
        rename_fields={"levelname": "level"}
    )
    handler.setFormatter(formatter)
    handler.addFilter(CorrelationIdFilter())
    test_logger.addHandler(handler)
    
    test_logger.info("A test json message")
    
    output = log_capture.getvalue()
    log_dict = json.loads(output)
    
    assert log_dict["correlation_id"] == "test-json-123"
    assert log_dict["message"] == "A test json message"
    assert log_dict["level"] == "INFO"
    assert log_dict["name"] == "test_json"
    assert "asctime" in log_dict

def test_prometheus_metrics():
    # Initial state
    jobs_before = REGISTRY.get_sample_value('jobs_run_total') or 0.0
    
    JOBS_RUN_TOTAL.inc()
    jobs_after = REGISTRY.get_sample_value('jobs_run_total') or 0.0
    assert jobs_after == jobs_before + 1.0

    # API Failures
    api_fails_before = REGISTRY.get_sample_value('api_failures_total', {'method': 'GET', 'endpoint': '/test'}) or 0.0
    API_FAILURES_TOTAL.labels(method="GET", endpoint="/test").inc()
    api_fails_after = REGISTRY.get_sample_value('api_failures_total', {'method': 'GET', 'endpoint': '/test'}) or 0.0
    assert api_fails_after == api_fails_before + 1.0

    # Anomalies
    anomaly_before = REGISTRY.get_sample_value('anomalies_detected_total', {'metric_name': 'test_metric'}) or 0.0
    ANOMALIES_DETECTED_TOTAL.labels(metric_name="test_metric").inc()
    anomaly_after = REGISTRY.get_sample_value('anomalies_detected_total', {'metric_name': 'test_metric'}) or 0.0
    assert anomaly_after == anomaly_before + 1.0
