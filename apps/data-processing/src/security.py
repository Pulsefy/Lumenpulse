"""
Security middleware for API key authentication and rate limiting.
Includes admin token verification for KPI recompute endpoints.
"""

import os
import re
from typing import Optional, Callable, Dict, Any
from functools import wraps
from fastapi import Request, HTTPException, status, Header
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from jose import JWTError, jwt
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Setup logger
from src.utils.logger import setup_logger
logger = setup_logger(__name__)


class SecurityConfig:
    """Security configuration manager."""
    
    def __init__(self):
        self.api_key = os.getenv("API_KEY", "")
        self.rate_limit_enabled = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
        self.rate_limit_default = os.getenv("RATE_LIMIT_DEFAULT", "100/minute")
        self.rate_limit_strict = os.getenv("RATE_LIMIT_STRICT", "10/minute")
        
        # Admin token for development and testing
        self.admin_api_token = os.getenv("ADMIN_API_TOKEN", "")
        self.jwt_secret = os.getenv("JWT_SECRET", "super-secret-jwt-key-change-in-production")
        
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
    
    def verify_admin_token(self, authorization: Optional[str] = None) -> bool:
        """
        Verify admin token from Authorization header.
        
        Supports both:
        1. Simple admin API token (for development)
        2. JWT with admin role (for production)
        
        Args:
            authorization: Authorization header value (optional)
            
        Returns:
            True if admin token is valid, False otherwise
        """
        if not authorization:
            logger.warning("No authorization header provided for admin verification")
            return False
        
        # Check for Bearer token
        parts = authorization.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            logger.warning("Invalid authorization header format for admin verification")
            return False
        
        token = parts[1]
        
        # For development, check against configured admin token
        if self.admin_api_token and token == self.admin_api_token:
            logger.debug("Admin API token verified successfully")
            return True
        
        # Try to validate as JWT
        try:
            payload = jwt.decode(token, self.jwt_secret, algorithms=["HS256"])
            
            # Check for admin role
            if payload.get("role") in ["admin", "superadmin"]:
                logger.debug(f"JWT admin role verified: {payload.get('role')}")
                return True
            
            # Check for admin flag
            if payload.get("is_admin") is True:
                logger.debug("JWT admin flag verified")
                return True
                
        except JWTError as e:
            logger.warning(f"JWT validation failed for admin verification: {e}")
        except Exception as e:
            logger.error(f"Unexpected error during admin token verification: {e}")
        
        return False
    
    def get_current_user(self, authorization: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Get current user from JWT token.
        
        Args:
            authorization: Authorization header value (optional)
            
        Returns:
            User payload dict if valid, None otherwise
        """
        if not authorization:
            return None
        
        parts = authorization.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return None
        
        token = parts[1]
        
        try:
            payload = jwt.decode(token, self.jwt_secret, algorithms=["HS256"])
            return payload
        except JWTError as e:
            logger.warning(f"JWT validation failed for user extraction: {e}")
        except Exception as e:
            logger.error(f"Unexpected error during user extraction: {e}")
        
        return None
    
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


def require_admin_token(func: Callable) -> Callable:
    """
    Decorator to require admin token authentication for an endpoint.
    
    This is stricter than require_api_key - it requires admin-level access.
    
    Usage:
        @app.post("/admin/recompute")
        @require_admin_token
        async def admin_endpoint(request: Request):
            ...
    """
    @wraps(func)
    async def wrapper(request: Request, *args, **kwargs) -> Any:
        # First validate API key
        security_config.validate_api_key(request)
        
        # Then validate admin token
        auth_header = request.headers.get("Authorization")
        if not security_config.verify_admin_token(auth_header):
            logger.warning(f"Admin access denied for {request.url.path} from {request.client.host}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin access required. Please provide valid admin token.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
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

        # Lineage endpoints are read-only manifest inspection — no auth required
        if request.url.path in excluded_paths or request.url.path.startswith("/api/lineage"):
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


# Convenience functions for admin verification (used by KPI routes)

def verify_admin_token(
    authorization: Optional[str] = Header(None, alias="Authorization"),
) -> bool:
    """
    Dependency function for FastAPI routes to verify admin token.
    
    This is the function used in route definitions:
        @app.post("/admin/endpoint")
        async def endpoint(admin: bool = Depends(verify_admin_token)):
            ...
    
    Args:
        authorization: Authorization header (injected by FastAPI)
        
    Returns:
        True if admin token is valid
        
    Raises:
        HTTPException: If admin token is invalid or missing
    """
    if not security_config.verify_admin_token(authorization):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required. Please provide valid admin token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return True


def get_current_user_dependency(
    authorization: Optional[str] = Header(None, alias="Authorization"),
) -> Optional[Dict[str, Any]]:
    """
    Dependency function for FastAPI routes to get current user.
    
    Usage:
        @app.get("/profile")
        async def profile(user: dict = Depends(get_current_user_dependency)):
            ...
    
    Args:
        authorization: Authorization header (injected by FastAPI)
        
    Returns:
        User payload dict if valid, raises HTTPException otherwise
    """
    user = security_config.get_current_user(authorization)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing authorization token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


# Backward compatibility aliases
def verify_admin_token_deprecated(
    authorization: Optional[str] = Header(None, alias="Authorization"),
) -> bool:
    """
    Deprecated: Use verify_admin_token instead.
    
    This is kept for backward compatibility with existing code.
    """
    return verify_admin_token(authorization)


def get_current_user_deprecated(
    authorization: Optional[str] = Header(None, alias="Authorization"),
) -> Optional[dict]:
    """
    Deprecated: Use get_current_user_dependency instead.
    
    This is kept for backward compatibility with existing code.
    """
    return get_current_user_dependency(authorization)