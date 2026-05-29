import logging
import contextvars
import uuid
from pythonjsonlogger import jsonlogger

# Context variable for correlation ID
correlation_id_ctx = contextvars.ContextVar("correlation_id", default="system")


class CorrelationIdFilter(logging.Filter):
    """Injects correlation ID into the log record"""

    def filter(self, record):
        record.correlation_id = correlation_id_ctx.get()
        return True


def setup_logger(name: str = "lumenpulse", level: int = logging.INFO) -> logging.Logger:
    """Setup a structured JSON logger"""
    logger = logging.getLogger(name)

    # Avoid duplicate handlers if setup_logger is called multiple times
    if logger.handlers:
        return logger

    logger.setLevel(level)
    logger.propagate = False

    handler = logging.StreamHandler()

    # Use python-json-logger for JSON formatting
    formatter = jsonlogger.JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(correlation_id)s %(message)s",
        rename_fields={
            "levelname": "level"
        }
    )
    handler.setFormatter(formatter)
    
    # Add filter to inject correlation ID
    filter = CorrelationIdFilter()
    logger.addFilter(filter)
    handler.addFilter(filter)

    logger.addHandler(handler)
    return logger

def get_logger(name: str) -> logging.Logger:
    return setup_logger(name)

def generate_correlation_id() -> str:
    return str(uuid.uuid4())
