import logging
import random
import time
from typing import Optional

import requests

logger = logging.getLogger("RobustHTTPClient")


class CircuitBreakerOpenException(Exception):
    """Raised when the circuit breaker is open and fast-failing requests."""

    pass


class RobustHTTPClient(requests.Session):
    """
    A robust HTTP client extending requests.Session.
    Features:
    - Exponential backoff with jitter for transient errors (500, 502, 503, 504, 429) and connection issues.
    - Circuit Breaker pattern to protect downstream services and fail fast.
    """

    def __init__(
        self,
        max_retries: int = 4,
        backoff_factor: float = 1.5,
        status_forcelist: Optional[set[int]] = None,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
    ):
        super().__init__()
        self.max_retries = max_retries
        self.backoff_factor = backoff_factor
        self.status_forcelist = status_forcelist or {429, 500, 502, 503, 504}

        # Circuit Breaker state
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failure_count = 0
        self.state = "CLOSED"  # CLOSED, OPEN, HALF-OPEN
        self.last_state_change = time.time()
        self._circuit_opened_at = 0.0

    def _check_circuit(self) -> None:
        """Check and update circuit breaker state."""
        if self.state == "OPEN":
            elapsed = time.time() - self._circuit_opened_at
            if elapsed > self.recovery_timeout:
                self.state = "HALF-OPEN"
                self.last_state_change = time.time()
                logger.warning(
                    "Circuit breaker transitioning to HALF-OPEN. Allowing trial request."
                )
            else:
                raise CircuitBreakerOpenException(
                    f"Circuit breaker is OPEN. Fast-failing request. Time remaining: {self.recovery_timeout - elapsed:.1f}s"
                )

    def _record_success(self) -> None:
        """Record a successful request and reset breaker state if needed."""
        if self.state == "HALF-OPEN":
            logger.info(
                "Trial request succeeded. Circuit breaker transitioning to CLOSED."
            )
        self.failure_count = 0
        self.state = "CLOSED"
        self.last_state_change = time.time()

    def _record_failure(self) -> None:
        """Record a failed request and trip breaker if threshold exceeded."""
        self.failure_count += 1
        if self.state == "HALF-OPEN" or self.failure_count >= self.failure_threshold:
            self.state = "OPEN"
            self._circuit_opened_at = time.time()
            self.last_state_change = time.time()
            logger.error(
                f"Circuit breaker tripped to OPEN. Failure count: {self.failure_count}. "
                f"Will reject requests for next {self.recovery_timeout} seconds."
            )

    def request(self, method: str, url: str, **kwargs) -> requests.Response:
        """
        Sends an HTTP request with retry logic and circuit breaker protection.
        """
        self._check_circuit()

        # Respect any custom timeout or set a default of 10s
        if "timeout" not in kwargs:
            kwargs["timeout"] = 10.0

        retries = 0
        while True:
            try:
                response = super().request(method, url, **kwargs)

                # Check if the status code is a transient error that warrants a retry
                if response.status_code in self.status_forcelist:
                    raise requests.exceptions.HTTPError(
                        f"Transient status {response.status_code}", response=response
                    )

                # If we get here, it's a successful response (or non-retryable error like 400/404)
                self._record_success()
                return response

            except (
                requests.exceptions.ConnectionError,
                requests.exceptions.Timeout,
                requests.exceptions.HTTPError,
            ) as e:

                # Check if the error response is non-retryable (e.g. 400 Bad Request)
                if isinstance(e, requests.exceptions.HTTPError):
                    status_code = e.response.status_code
                    if status_code not in self.status_forcelist:
                        # Non-retryable HTTP error; record success (meaning server responded normally) and raise
                        self._record_success()
                        raise e

                retries += 1
                if retries > self.max_retries:
                    logger.error(
                        f"Max retries ({self.max_retries}) exceeded for {url}. Failure details: {str(e)}"
                    )
                    self._record_failure()
                    raise e

                # Calculate exponential backoff with jitter
                sleep_time = self.backoff_factor * (2 ** (retries - 1))
                sleep_time += random.uniform(0, 0.5)  # Add jitter

                logger.warning(
                    f"Request to {url} failed: {str(e)}. "
                    f"Retrying in {sleep_time:.2f}s... (Attempt {retries}/{self.max_retries})"
                )
                time.sleep(sleep_time)
