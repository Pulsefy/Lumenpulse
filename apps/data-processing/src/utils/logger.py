"""
Logging utilities for data-processing service.

Provides structured JSON logging with correlation ID support and
simple logging setup for backward compatibility.
"""

import logging
import sys
import contextvars
import uuid
from typing import Optional, Union
from pythonjsonlogger import jsonlogger

# Context variable for correlation ID
correlation_id_ctx = contextvars.ContextVar("correlation_id", default="system")


class CorrelationIdFilter(logging.Filter):
    """Injects correlation ID into the log record"""
    
    def filter(self, record):
        record.correlation_id = correlation_id_ctx.get()
        return True


class SimpleFormatter(logging.Formatter):
    """Simple text formatter for console output when JSON not needed."""
    
    def __init__(self, format_string: Optional[str] = None):
        if format_string is None:
            format_string = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        super().__init__(format_string)


def setup_logger(
    name: Optional[str] = None,
    level: Union[str, int] = "INFO",
    format_string: Optional[str] = None,
    json_format: bool = False,
) -> logging.Logger:
    """
    Set up a logger with consistent formatting.

    Args:
        name: Logger name (defaults to root)
        level: Log level, either a name (DEBUG, INFO, WARNING, ERROR,
            CRITICAL) or a numeric level such as logging.INFO
        format_string: Custom format string (for text format only)
        json_format: Use JSON format instead of text

    Returns:
        Configured logger instance

    Examples:
        # Text format logger
        logger = setup_logger("my_service", level="DEBUG")

        # JSON format logger with correlation ID
        logger = setup_logger("my_service", json_format=True)
    """
    logger_name = name or __name__

    # Check if logger already exists and has handlers
    existing_logger = logging.getLogger(logger_name)
    if existing_logger.handlers:
        return existing_logger

    logger = logging.getLogger(logger_name)
    resolved_level = (
        getattr(logging, level.upper(), logging.INFO)
        if isinstance(level, str)
        else level
    )
    logger.setLevel(resolved_level)
    logger.propagate = False
    
    # Create handler
    handler = logging.StreamHandler(sys.stdout)
    
    # Set formatter based on format type
    if json_format:
        # Use JSON formatter with correlation ID
        formatter = jsonlogger.JsonFormatter(
            "%(asctime)s %(levelname)s %(name)s %(correlation_id)s %(message)s",
            rename_fields={
                "levelname": "level",
                "asctime": "timestamp"
            }
        )
        handler.setFormatter(formatter)
        
        # Add correlation ID filter
        filter = CorrelationIdFilter()
        logger.addFilter(filter)
        handler.addFilter(filter)
    else:
        # Use simple text formatter
        if format_string is None:
            format_string = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        formatter = SimpleFormatter(format_string)
        handler.setFormatter(formatter)
    
    # Add handler to logger
    logger.addHandler(handler)
    
    return logger


def get_logger(name: str) -> logging.Logger:
    """
    Get a configured logger with JSON format.
    
    This is the main logger function used by the application.
    It provides structured JSON logging with correlation ID support.
    
    Args:
        name: Logger name (usually __name__)
        
    Returns:
        Configured JSON logger instance
        
    Example:
        logger = get_logger(__name__)
        logger.info("Processing request", extra={"user_id": 123})
    """
    return setup_logger(name, json_format=True)


def generate_correlation_id() -> str:
    """Generate a unique correlation ID for request tracing."""
    return str(uuid.uuid4())


def get_correlation_id() -> str:
    """Get the current correlation ID from context."""
    return correlation_id_ctx.get()


def set_correlation_id(correlation_id: str) -> None:
    """
    Set the correlation ID in context.
    
    Args:
        correlation_id: Correlation ID to set
    """
    correlation_id_ctx.set(correlation_id)


# Backward compatibility aliases
def setup_logger_simple(
    name: Optional[str] = None,
    level: str = "INFO",
    format_string: Optional[str] = None,
) -> logging.Logger:
    """
    Simple logger setup without JSON format.
    
    This is a backward compatibility alias for the original setup_logger.
    """
    return setup_logger(name, level, format_string, json_format=False)


def setup_logger_json(
    name: Optional[str] = None,
    level: str = "INFO",
) -> logging.Logger:
    """
    JSON logger setup with correlation ID.
    
    This is a backward compatibility alias for the JSON logger.
    """
    return setup_logger(name, level, json_format=True)


# Default logger instance for module-level imports
logger = get_logger(__name__)


# Example usage demonstration
if __name__ == "__main__":
    # Test text logger
    text_logger = setup_logger("text_test", level="DEBUG", json_format=False)
    text_logger.info("This is a text log message")
    text_logger.debug("Debug message with %s", "formatting")
    
    # Test JSON logger
    json_logger = get_logger("json_test")
    json_logger.info("This is a JSON log message", extra={"user_id": 123, "action": "test"})
    
    # Test with correlation ID
    set_correlation_id(generate_correlation_id())
    json_logger.info("Request with correlation ID", extra={"path": "/api/test"})
    
    print("\nLogger test completed. Check output for format differences.")