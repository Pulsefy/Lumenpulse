import logging
import time
from typing import Any, Dict, Optional, Union
import requests
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)
import pybreaker

logger = logging.getLogger(__name__)

# Define a centralized circuit breaker for all HTTP calls
# It will open if 5 consecutive failures occur (excluding 4xx)
# It will stay open for 30 seconds
http_breaker = pybreaker.CircuitBreaker(
    fail_max=5,
    reset_timeout=30,
)


class RobustHTTPClient:
    """
    A robust HTTP client wrapper with retries, exponential backoff,
    and circuit breaker patterns.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        max_retries: int = 3,
        timeout: int = 30,
    ):
        self.base_url = base_url.rstrip("/") if base_url else ""
        self.max_retries = max_retries
        self.timeout = timeout
        self.session = requests.Session()

    def _url(self, path: str) -> str:
        if path.startswith(("http://", "https://")):
            return path
        return f"{self.base_url}/{path.lstrip('/')}"

    def request(self, method: str, path: str, **kwargs) -> requests.Response:
        """
        Make an HTTP request with retry logic and circuit breaker protection.
        """
        url = self._url(path)

        # Set default timeout if not provided
        if "timeout" not in kwargs:
            kwargs["timeout"] = self.timeout

        # Define the request function to be called within the retry loop
        @retry(
            stop=stop_after_attempt(self.max_retries),
            wait=wait_exponential(multiplier=1, min=2, max=10),
            retry=retry_if_exception_type(
                (
                    requests.exceptions.Timeout,
                    requests.exceptions.ConnectionError,
                    requests.exceptions.HTTPError,
                )
            ),
            before_sleep=before_sleep_log(logger, logging.WARNING),
            reraise=True,
        )
        def _do_request():
            # Use circuit breaker to protect the call
            return http_breaker.call(self._actual_request, method, url, **kwargs)

        try:
            return _do_request()
        except requests.exceptions.HTTPError as e:
            # Special handling for 429 if we didn't retry enough or want to respect Retry-After
            if e.response is not None and e.response.status_code == 429:
                retry_after = e.response.headers.get("Retry-After")
                if retry_after:
                    try:
                        seconds = float(retry_after)
                        logger.warning(f"Rate limited. Waiting for {seconds}s as requested by server.")
                        time.sleep(seconds)
                        # We could retry one more time here or just let the caller handle it.
                        # For simplicity, we'll let the initial retry loop handle basic cases,
                        # but this shows how we'd respect the header.
                    except ValueError:
                        pass
            raise

    def _actual_request(self, method: str, url: str, **kwargs) -> requests.Response:
        """
        The actual underlying request call.
        """
        start_time = time.time()
        try:
            response = self.session.request(method, url, **kwargs)
            duration = time.time() - start_time

            # Log successful requests
            logger.info(
                f"HTTP {method} {url} - {response.status_code} ({duration:.2f}s)",
                extra={
                    "method": method,
                    "url": url,
                    "status_code": response.status_code,
                    "duration": duration,
                },
            )

            # Raise for 5xx and 429 errors to trigger retry
            if 500 <= response.status_code < 600 or response.status_code == 429:
                response.raise_for_status()

            return response

        except requests.exceptions.RequestException as e:
            duration = time.time() - start_time
            logger.error(
                f"HTTP {method} {url} failed: {str(e)}",
                extra={
                    "method": method,
                    "url": url,
                    "error": str(e),
                    "duration": duration,
                },
            )
            # Circuit breaker will see this exception
            raise

    def get(self, path: str, **kwargs) -> requests.Response:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs) -> requests.Response:
        return self.request("POST", path, **kwargs)

    def put(self, path: str, **kwargs) -> requests.Response:
        return self.request("PUT", path, **kwargs)

    def delete(self, path: str, **kwargs) -> requests.Response:
        return self.request("DELETE", path, **kwargs)

    def close(self):
        """Close the underlying requests session."""
        self.session.close()
