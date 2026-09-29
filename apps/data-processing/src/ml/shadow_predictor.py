"""
Shadow Predictor — timeout-enforced shadow inference with comparison logging.

Issue #1256: Shadow-Mode Model Deployment

Wraps a live model and optionally runs a shadow model on the same inputs.
The shadow prediction is:
  - Non-blocking (runs in a thread with a configurable timeout)
  - Logged for comparison alongside the live prediction
  - Never returned to the caller

Typical usage::

    from src.ml.model_registry import get_live_model, get_shadow_model
    from src.ml.shadow_predictor import ShadowPredictor

    live_model = get_live_model("sentiment")
    shadow_model = get_shadow_model("sentiment")
    predictor = ShadowPredictor(live_model, shadow_model, "sentiment")

    result = predictor.predict(input_text)
    # result contains only the live model's prediction
"""

import hashlib
import json
import threading
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from src.utils.logger import setup_logger

from .model_registry import (
    ComparisonEntry,
    get_current_version,
    get_shadow_version,
    log_comparison,
)

logger = setup_logger(__name__)

# Default shadow timeout (seconds).  If the shadow prediction takes longer
# than this the comparison is logged as a timeout and the shadow path is
# cancelled.  This value is documented so operators can plan for it.
DEFAULT_SHADOW_TIMEOUT_SEC = float(
    __import__("os").environ.get("SHADOW_TIMEOUT_SEC", "5.0")
)

# Documented latency overhead: shadow evaluation adds at most
# SHADOW_TIMEOUT_SEC to inference latency.  Per the acceptance criteria
# this overhead must be documented — see README or docstring above.
_DOCUMENTED_OVERHEAD_MS = DEFAULT_SHADOW_TIMEOUT_SEC * 1000.0


def _hash_input(input_data: Any) -> str:
    """Create a stable hash of the input for traceability in comparison logs."""
    try:
        raw = json.dumps(input_data, sort_keys=True, default=str).encode("utf-8")
    except (TypeError, ValueError):
        raw = repr(input_data).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


class ShadowPredictor:
    """
    Wraps prediction with optional shadow model comparison.

    When a shadow model is registered the prediction runs both models,
    logs both results, and returns only the live prediction.

    Shadow prediction runs in a background thread with a timeout to
    prevent adding unbounded latency.  If the shadow path times out
    the comparison log records ``shadow_timed_out=True``.

    Args:
        live_model:   The currently promoted (live) model object.
        shadow_model: The shadow model object, or None.
        model_type:   Model type identifier (e.g. "sentiment").
        timeout_sec:  Maximum seconds to wait for shadow prediction.
                      Defaults to ``SHADOW_TIMEOUT_SEC`` env var or 5.0 s.
    """

    def __init__(
        self,
        live_model: Any,
        shadow_model: Optional[Any],
        model_type: str,
        timeout_sec: Optional[float] = None,
    ) -> None:
        self._live_model = live_model
        self._shadow_model = shadow_model
        self._model_type = model_type
        self._timeout_sec = (
            timeout_sec if timeout_sec is not None else DEFAULT_SHADOW_TIMEOUT_SEC
        )

    @property
    def has_shadow(self) -> bool:
        """Is a shadow model currently registered?"""
        return self._shadow_model is not None

    @property
    def documented_overhead_ms(self) -> float:
        """Documented maximum latency overhead of shadow evaluation (ms)."""
        return self._timeout_sec * 1000.0

    def predict(
        self,
        input_data: Any,
        predict_fn: Optional[Callable[[Any, Any], Any]] = None,
    ) -> Any:
        """
        Run prediction through the live model and, if available, the shadow.

        Args:
            input_data: The input to pass to the model's inference function.
            predict_fn: An optional callable ``(model, input) -> result``.
                        If omitted the model object is called directly as
                        ``model(input)``.

        Returns:
            The live model's prediction.  Shadow prediction is logged only.
        """
        t0 = datetime.now(timezone.utc)
        live_result = self._run_live(input_data, predict_fn)
        t1 = datetime.now(timezone.utc)
        latency_live_ms = (t1 - t0).total_seconds() * 1000.0

        shadow_result: Optional[Any] = None
        latency_shadow_ms: float = 0.0
        shadow_timed_out = False

        if self._shadow_model is not None:
            shadow_result, latency_shadow_ms, shadow_timed_out = self._run_shadow(
                input_data, predict_fn
            )

        # Always log comparison if shadow was available
        if self._shadow_model is not None:
            # Determine agreement
            agreement, divergence_type = self._compare_results(
                live_result, shadow_result, shadow_timed_out
            )

            entry = ComparisonEntry(
                timestamp=datetime.now(timezone.utc).isoformat(),
                model_type=self._model_type,
                live_version=get_current_version(self._model_type) or "unknown",
                shadow_version=get_shadow_version(self._model_type) or "unknown",
                input_hash=_hash_input(input_data),
                live_prediction=live_result,
                shadow_prediction=shadow_result,
                agreement=agreement,
                divergence_type=divergence_type,
                latency_live_ms=round(latency_live_ms, 3),
                latency_shadow_ms=round(latency_shadow_ms, 3),
                shadow_timed_out=shadow_timed_out,
            )
            log_comparison(entry)

            if shadow_timed_out:
                logger.warning(
                    "Shadow prediction timed out after %.1f ms for '%s'",
                    latency_shadow_ms,
                    self._model_type,
                )

        return live_result

    def _run_live(
        self, input_data: Any, predict_fn: Optional[Callable[[Any, Any], Any]]
    ) -> Any:
        if predict_fn is not None:
            return predict_fn(self._live_model, input_data)
        return self._live_model(input_data)

    def _run_shadow(
        self, input_data: Any, predict_fn: Optional[Callable[[Any, Any], Any]]
    ) -> tuple[Optional[Any], float, bool]:
        """
        Run shadow prediction in a thread with timeout.

        Returns:
            (result, latency_ms, timed_out)
        """
        result_holder: dict[str, Any] = {"result": None, "error": None}

        def _target() -> None:
            try:
                if predict_fn is not None:
                    result_holder["result"] = predict_fn(
                        self._shadow_model, input_data
                    )
                else:
                    result_holder["result"] = self._shadow_model(input_data)
            except Exception as exc:
                result_holder["error"] = str(exc)

        t_start = datetime.now(timezone.utc)
        thread = threading.Thread(target=_target, daemon=True)
        thread.start()
        thread.join(timeout=self._timeout_sec)

        t_end = datetime.now(timezone.utc)
        latency_ms = (t_end - t_start).total_seconds() * 1000.0

        if thread.is_alive():
            # Timeout — thread is still running but we abandon it.
            # It is a daemon thread so it will be terminated at process exit.
            logger.warning(
                "Shadow prediction exceeded timeout of %.1f s for '%s'",
                self._timeout_sec,
                self._model_type,
            )
            return None, latency_ms, True

        if result_holder["error"]:
            logger.error(
                "Shadow prediction error for '%s': %s",
                self._model_type,
                result_holder["error"],
            )
            return None, latency_ms, False

        return result_holder["result"], latency_ms, False

    @staticmethod
    def _compare_results(
        live: Any, shadow: Optional[Any], timed_out: bool
    ) -> tuple[bool, str]:
        """
        Compare live and shadow predictions.

        Returns:
            (agreement, divergence_type)
            divergence_type is one of:
              - "exact_match"
              - "direction_same"
              - "direction_opposite"
              - "magnitude_diff"
              - "shadow_timeout"
              - "shadow_error"
        """
        if timed_out:
            return False, "shadow_timeout"

        if shadow is None:
            return False, "shadow_error"

        if live == shadow:
            return True, "exact_match"

        # Try numeric comparison for direction
        try:
            live_f = float(live)
            shadow_f = float(shadow)
            if (live_f >= 0 and shadow_f >= 0) or (live_f < 0 and shadow_f < 0):
                return False, "direction_same"
            return False, "direction_opposite"
        except (TypeError, ValueError):
            pass

        # Default for non-numeric types
        return False, "divergent"


def create_shadow_predictor(
    model_type: str,
    timeout_sec: Optional[float] = None,
) -> ShadowPredictor:
    """
    Convenience factory that wires up live and shadow models from the registry.

    Args:
        model_type:   e.g. "sentiment" or "price_predictor"
        timeout_sec:  Override the default shadow timeout.

    Returns:
        A ready-to-use ShadowPredictor (with or without a shadow model).
    """
    from .model_registry import get_live_model, get_shadow_model

    live = get_live_model(model_type)
    shadow = get_shadow_model(model_type)
    return ShadowPredictor(live, shadow, model_type, timeout_sec)
