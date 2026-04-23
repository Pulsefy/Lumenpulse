"""
Security middleware for API key authentication and rate limiting.
"""

import os
import re
from typing import Optional, Callable, Dict, Any
from functools import wraps
from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class SecurityConfig:
    """Security configuration manager."""
    
    def __init__(self):
        self.api_key = os.getenv("API_KEY", "")
        self.rate_limit_enabled = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
        self.rate_limit_default = os.getenv("RATE_LIMIT_DEFAULT", "100/minute")
        self.rate_limit_strict = os.getenv("RATE_LIMIT_STRICT", "10/minute")
        
        # Parse rate limit strings
        self._validate_rate_limit(self.rate_limit_default)
        self._validate_rate_limit(self.rate_limit_strict)
    
    def _validate_rate_limit(self, limit_string: str) -> None:
        """Validate rate limit string format (e.g., '100/minute')."""
        pattern = r'^\d+/(second|minute|hour|day)$'
        if not re.match(pattern, limit_string):
            raise ValueError(
                f"Invalid rate limit format: {limit_string}. "
                "Expected format: 'N/second', 'N/minute', 'N/hour', or 'N/day'"
            )
    
    @property
    def limiter(self) -> Optional[Limiter]:
        """Create and configure the rate limiter."""
        if not self.rate_limit_enabled:
            return None
        
        limiter = Limiter(
            key_func=get_remote_address,
            default_limits=[self.rate_limit_default],
            storage_uri="memory://",  # In-memory storage (use redis:// for production)
        )
        return limiter
    
    def validate_api_key(self, request: Request) -> bool:
        """
        Validate API key from request headers.
        
        Args:
            request: FastAPI request object
            
        Returns:
            True if API key is valid
            
        Raises:
            HTTPException: If API key is missing or invalid
        """
        if not self.api_key:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="API is not configured: API_KEY environment variable is missing.",
            )

        api_key_header = request.headers.get("X-API-Key")
        
        if not api_key_header:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing API key. Please provide X-API-Key header.",
                headers={"WWW-Authenticate": "ApiKey"},
            )
        
        if api_key_header != self.api_key:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid API key",
                headers={"WWW-Authenticate": "ApiKey"},
            )
        
        return True
    
    def get_limiter_for_endpoint(self, endpoint_type: str = "default") -> Optional[Limiter]:
        """
        Get a limiter configured for a specific endpoint type.
        
        Args:
            endpoint_type: Type of endpoint ('default' or 'strict')
            
        Returns:
            Configured Limiter instance or None if rate limiting is disabled
        """
        if not self.rate_limit_enabled:
            return None
        
        limit_string = (
            self.rate_limit_strict 
            if endpoint_type == "strict" 
            else self.rate_limit_default
        )
        
        limiter = Limiter(
            key_func=get_remote_address,
            default_limits=[limit_string],
            storage_uri="memory://",
        )
        return limiter


# Global security config instance
security_config = SecurityConfig()


def require_api_key(func: Callable) -> Callable:
    """
    Decorator to require API key authentication for an endpoint.
    
    Usage:
        @app.get("/protected")
        @require_api_key
        async def protected_endpoint(request: Request):
            ...
    """
    @wraps(func)
    async def wrapper(request: Request, *args, **kwargs) -> Any:
        security_config.validate_api_key(request)
        return await func(request, *args, **kwargs)
    return wrapper


def setup_security_middleware(app) -> None:
    """
    Setup security middleware for a FastAPI application.
    
    Args:
        app: FastAPI application instance
    """
    @app.middleware("http")
    async def api_key_middleware(request: Request, call_next):
        """Middleware to check API key for all requests except health/metrics."""
        # Skip API key check for health checks and metrics
        excluded_paths = [
            "/health",
            "/metrics",
            "/",
            "/docs",
            "/redoc",
            "/openapi.json",
            "/sentiment/legend",
        ]
        
        if request.url.path in excluded_paths:
            return await call_next(request)
        
        # Validate API key
        try:
            security_config.validate_api_key(request)
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail},
                headers=exc.headers,
            )
        
        # Continue processing
        return await call_next(request)


def setup_rate_limiter(app, limiter: Limiter) -> None:
    """
    Setup rate limiting for a FastAPI application.
    
    Args:
        app: FastAPI application instance
        limiter: Slowapi Limiter instance
    """
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    
    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
        """Custom rate limit exceeded handler."""
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={
                "detail": "Rate limit exceeded",
                "message": "Too many requests. Please try again later.",
                "retry_after": str(exc.detail),
            },
        )


def get_rate_limit_decorator(limiter: Limiter, limit_string: Optional[str] = None):
    """
    Get a rate limit decorator for specific endpoints.
    
    Args:
        limiter: Slowapi Limiter instance
        limit_string: Optional custom limit (e.g., "10/minute")
        
    Returns:
        Decorator function for rate limiting
    """
    if limit_string:
        return limiter.limit(limit_string)
    return limiter.limit
