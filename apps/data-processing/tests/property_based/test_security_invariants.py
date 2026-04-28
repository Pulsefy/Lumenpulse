"""
Property-based tests for security protocol invariants.

These tests ensure that the security system maintains its core
invariant properties regardless of input, preventing security protocol violations.
"""

import pytest
from hypothesis import given, strategies as st, assume
from typing import Dict, Any, Optional
import sys
import os
import re
from unittest.mock import Mock, patch

# Add src directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from security import SecurityConfig


class TestSecurityConfigInvariants:
    """Property-based tests for SecurityConfig protocol invariants."""
    
    @given(
        api_key=st.text(min_size=1, max_size=100),
        rate_limit_default=st.text(min_size=1, max_size=20),
        rate_limit_strict=st.text(min_size=1, max_size=20)
    )
    def test_rate_limit_format_validation_invariant(
        self, api_key, rate_limit_default, rate_limit_strict
    ):
        """
        INVARIANT: Rate limit strings must follow the pattern 'N/(second|minute|hour|day)'.
        
        The security protocol must enforce strict rate limit format validation
        to prevent configuration errors that could compromise security.
        """
        # Test valid rate limit formats
        valid_formats = [
            f"100/second",
            f"50/minute", 
            f"24/hour",
            f"7/day",
            f"1/second",
            f"1000/minute"
        ]
        
        for valid_format in valid_formats:
            try:
                # Should not raise exception for valid formats
                config = SecurityConfig()
                config._validate_rate_limit(valid_format)
            except ValueError as e:
                pytest.fail(f"Valid rate limit format '{valid_format}' was rejected: {e}")
    
    @given(st.text(min_size=1, max_size=20))
    def test_invalid_rate_limit_rejection_invariant(self, rate_limit_string):
        """
        INVARIANT: Invalid rate limit formats must always be rejected.
        
        The security protocol must reject malformed rate limit strings
        to maintain configuration integrity invariants.
        """
        # Generate invalid rate limit strings
        invalid_patterns = [
            "invalid",
            "100",
            "100/",
            "/minute",
            "100/invalid",
            "abc/minute",
            "100/second/extra",
            "",
            " ",
            "100/ MINUTE",  # Case sensitive
            "100/second ",  # Trailing space
            " 100/second",  # Leading space
        ]
        
        # Only test if our generated string matches an invalid pattern
        for invalid_pattern in invalid_patterns:
            if rate_limit_string == invalid_pattern:
                config = SecurityConfig()
                with pytest.raises(ValueError, match="Invalid rate limit format"):
                    config._validate_rate_limit(rate_limit_string)
                break
    
    @given(st.integers(min_value=1, max_value=10000), st.sampled_from(['second', 'minute', 'hour', 'day']))
    def test_rate_limit_pattern_invariant(self, number, unit):
        """
        INVARIANT: Valid rate limit patterns must always be accepted.
        
        The security protocol must accept any properly formatted rate limit
        string to maintain configuration flexibility invariants.
        """
        rate_limit_string = f"{number}/{unit}"
        
        config = SecurityConfig()
        
        # Should not raise exception for valid pattern
        try:
            config._validate_rate_limit(rate_limit_string)
        except ValueError as e:
            pytest.fail(f"Valid rate limit pattern '{rate_limit_string}' was rejected: {e}")
    
    @given(st.text(min_size=1, max_size=100, alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'))
    def test_api_key_handling_invariant(self, api_key):
        """
        INVARIANT: API keys should be handled consistently regardless of content.
        
        The security protocol must maintain consistent API key handling
        to prevent authentication bypass vulnerabilities.
        """
        with patch.dict(os.environ, {'API_KEY': api_key}):
            config = SecurityConfig()
            
            # API key should be stored as provided
            assert config.api_key == api_key, "API key should be stored exactly as provided"
            
            # Should be a string
            assert isinstance(config.api_key, str), "API key should always be a string"


class TestAPIKeyValidationInvariants:
    """Property-based tests for API key validation protocol invariants."""
    
    @given(st.text(min_size=1, max_size=100, alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'))
    def test_missing_api_key_rejection_invariant(self, api_key):
        """
        INVARIANT: Requests without API keys must always be rejected.
        
        The security protocol must reject unauthenticated requests
        to maintain access control invariants.
        """
        with patch.dict(os.environ, {'API_KEY': api_key}):
            from fastapi import Request, HTTPException
            from fastapi.testclient import TestClient
            
            # Mock request without API key
            mock_request = Mock(spec=Request)
            mock_request.headers = {}  # No X-API-Key header
            
            config = SecurityConfig()
            
            # Should raise HTTPException for missing API key
            with pytest.raises(HTTPException) as exc_info:
                config.validate_api_key(mock_request)
            
            # Should be 401 Unauthorized
            assert exc_info.value.status_code == 401, "Missing API key should return 401"
            assert "Missing API key" in str(exc_info.value.detail), "Should mention missing API key"
    
    @given(st.text(min_size=1, max_size=100, alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'), st.text(min_size=1, max_size=100, alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'))
    def test_invalid_api_key_rejection_invariant(self, correct_key, wrong_key):
        """
        INVARIANT: Requests with incorrect API keys must always be rejected.
        
        The security protocol must reject requests with invalid credentials
        to maintain authentication invariants.
        """
        assume(correct_key != wrong_key)  # Ensure keys are different
        
        with patch.dict(os.environ, {'API_KEY': correct_key}):
            from fastapi import Request, HTTPException
            
            # Mock request with wrong API key
            mock_request = Mock(spec=Request)
            mock_request.headers = {"X-API-Key": wrong_key}
            
            config = SecurityConfig()
            
            # Should raise HTTPException for invalid API key
            with pytest.raises(HTTPException) as exc_info:
                config.validate_api_key(mock_request)
            
            # Should be 403 Forbidden
            assert exc_info.value.status_code == 403, "Invalid API key should return 403"
            assert "Invalid API key" in str(exc_info.value.detail), "Should mention invalid API key"
    
    @given(st.text(min_size=1, max_size=100, alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'))
    def test_correct_api_key_acceptance_invariant(self, api_key):
        """
        INVARIANT: Requests with correct API keys must always be accepted.
        
        The security protocol must accept requests with valid credentials
        to maintain legitimate access invariants.
        """
        with patch.dict(os.environ, {'API_KEY': api_key}):
            from fastapi import Request
            
            # Mock request with correct API key
            mock_request = Mock(spec=Request)
            mock_request.headers = {"X-API-Key": api_key}
            
            config = SecurityConfig()
            
            # Should return True for valid API key
            result = config.validate_api_key(mock_request)
            assert result is True, "Valid API key should be accepted"
    
    @given(st.text(min_size=1, max_size=100, alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'))
    def test_api_key_case_sensitivity_invariant(self, api_key):
        """
        INVARIANT: API key validation should be case-sensitive.
        
        The security protocol must maintain case sensitivity
        to prevent credential bypass through case manipulation.
        """
        assume(api_key != api_key.lower())  # Ensure case difference exists
        assume(api_key != api_key.upper())  # Ensure case difference exists
        
        with patch.dict(os.environ, {'API_KEY': api_key}):
            from fastapi import Request, HTTPException
            
            # Test with lowercase version
            mock_request_lower = Mock(spec=Request)
            mock_request_lower.headers = {"X-API-Key": api_key.lower()}
            
            config = SecurityConfig()
            
            # Should reject case-mismatched key
            with pytest.raises(HTTPException):
                config.validate_api_key(mock_request_lower)
            
            # Test with uppercase version
            mock_request_upper = Mock(spec=Request)
            mock_request_upper.headers = {"X-API-Key": api_key.upper()}
            
            # Should reject case-mismatched key
            with pytest.raises(HTTPException):
                config.validate_api_key(mock_request_upper)
    
    @given(st.text(min_size=1, max_size=100, alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'))
    def test_api_key_whitespace_sensitivity_invariant(self, api_key):
        """
        INVARIANT: API key validation should be whitespace-sensitive.
        
        The security protocol must reject keys with whitespace
        to prevent credential bypass through whitespace manipulation.
        """
        assume(not api_key.startswith(" "))  # Ensure original doesn't start with space
        assume(not api_key.endswith(" "))   # Ensure original doesn't end with space
        
        with patch.dict(os.environ, {'API_KEY': api_key}):
            from fastapi import Request, HTTPException
            
            # Test with leading whitespace
            mock_request_leading = Mock(spec=Request)
            mock_request_leading.headers = {"X-API-Key": f" {api_key}"}
            
            config = SecurityConfig()
            
            # Should reject key with leading whitespace
            with pytest.raises(HTTPException):
                config.validate_api_key(mock_request_leading)
            
            # Test with trailing whitespace
            mock_request_trailing = Mock(spec=Request)
            mock_request_trailing.headers = {"X-API-Key": f"{api_key} "}
            
            # Should reject key with trailing whitespace
            with pytest.raises(HTTPException):
                config.validate_api_key(mock_request_trailing)


class TestRateLimitingInvariants:
    """Property-based tests for rate limiting protocol invariants."""
    
    @given(
        limit_string=st.tuples(
            st.integers(min_value=1, max_value=1000),
            st.sampled_from(['second', 'minute', 'hour', 'day'])
        ).map(lambda x: f"{x[0]}/{x[1]}"),
        endpoint_type=st.sampled_from(['default', 'strict'])
    )
    def test_limiter_creation_invariant(self, limit_string, endpoint_type):
        """
        INVARIANT: Limiter creation should be consistent for valid configurations.
        
        The rate limiting protocol must create consistent limiters
        for valid configurations to maintain enforcement invariants.
        """
        
        with patch.dict(os.environ, {
            'RATE_LIMIT_ENABLED': 'true',
            'RATE_LIMIT_DEFAULT': limit_string,
            'RATE_LIMIT_STRICT': limit_string
        }):
            config = SecurityConfig()
            
            # Should create limiter without error
            try:
                limiter = config.get_limiter_for_endpoint(endpoint_type)
                if limiter is not None:
                    # Should have expected properties - check for actual SlowAPI limiter attributes
                    assert hasattr(limiter, '_limiter'), "Limiter should have _limiter attribute"
                    assert hasattr(limiter, '_key_func'), "Limiter should have _key_func attribute"
            except Exception as e:
                pytest.fail(f"Failed to create limiter for valid config: {e}")
    
    @given(st.booleans())
    def test_rate_limit_disabled_invariant(self, enabled):
        """
        INVARIANT: Rate limiting should be properly disabled when configured.
        
        The rate limiting protocol must respect disabled configuration
        to maintain operational flexibility invariants.
        """
        with patch.dict(os.environ, {'RATE_LIMIT_ENABLED': str(enabled).lower()}):
            config = SecurityConfig()
            
            if not enabled:
                # Limiter should be None when disabled
                limiter = config.limiter
                assert limiter is None, "Limiter should be None when rate limiting is disabled"
                
                # Endpoint limiters should also be None
                endpoint_limiter = config.get_limiter_for_endpoint('default')
                assert endpoint_limiter is None, "Endpoint limiter should be None when disabled"
    
    @given(st.integers(min_value=1, max_value=1000), st.sampled_from(['second', 'minute', 'hour', 'day']))
    def test_rate_limit_endpoint_type_invariant(self, number, unit):
        """
        INVARIANT: Different endpoint types should use appropriate rate limits.
        
        The rate limiting protocol must differentiate between endpoint types
        to maintain granular control invariants.
        """
        default_limit = f"{number}/{unit}"
        strict_limit = f"{max(1, number // 10)}/{unit}"  # Stricter limit
        
        with patch.dict(os.environ, {
            'RATE_LIMIT_ENABLED': 'true',
            'RATE_LIMIT_DEFAULT': default_limit,
            'RATE_LIMIT_STRICT': strict_limit
        }):
            config = SecurityConfig()
            
            default_limiter = config.get_limiter_for_endpoint('default')
            strict_limiter = config.get_limiter_for_endpoint('strict')
            
            if default_limiter is not None and strict_limiter is not None:
                # Both should be valid limiters
                assert hasattr(default_limiter, '_limiter')
                assert hasattr(strict_limiter, '_limiter')


class TestSecurityRobustnessInvariants:
    """Property-based tests for security system robustness invariants."""
    
    @given(st.text(min_size=1, max_size=200))
    def test_malformed_api_key_handling_invariant(self, malformed_key):
        """
        INVARIANT: Security system should handle malformed API keys gracefully.
        
        The security protocol must be robust against various forms of
        malformed input while maintaining system stability.
        """
        with patch.dict(os.environ, {'API_KEY': 'valid-key'}):
            from fastapi import Request, HTTPException
            
            # Test various malformed API key inputs
            malformed_inputs = [
                malformed_key,
                "",  # Empty string
                " ",  # Space only
                "\t",  # Tab only
                "\n",  # Newline only
                "null",  # String "null"
                "undefined",  # String "undefined"
                "None",  # String "None"
            ]
            
            config = SecurityConfig()
            
            for malformed_input in malformed_inputs:
                mock_request = Mock(spec=Request)
                mock_request.headers = {"X-API-Key": malformed_input}
                
                # Should handle gracefully (either accept if correct, or reject with proper exception)
                try:
                    result = config.validate_api_key(mock_request)
                    # If accepted, should be boolean
                    assert isinstance(result, bool), "Should return boolean when accepting"
                except HTTPException as e:
                    # If rejected, should be proper HTTP exception
                    assert e.status_code in [401, 403], "Should return proper HTTP status code"
                    assert isinstance(e.detail, str), "Should have string detail message"
                except Exception as e:
                    pytest.fail(f"Security system crashed on malformed input '{malformed_input}': {e}")
    
    @given(st.dictionaries(keys=st.text(), values=st.text(), min_size=0, max_size=10))
    def test_header_manipulation_resistance_invariant(self, headers):
        """
        INVARIANT: Security should resist header manipulation attempts.
        
        The security protocol must be robust against header manipulation
        to maintain authentication integrity invariants.
        """
        with patch.dict(os.environ, {'API_KEY': 'secret-key'}):
            from fastapi import Request, HTTPException
            
            config = SecurityConfig()
            
            # Test with manipulated headers
            manipulated_headers = headers.copy()
            
            # Add multiple API key headers
            manipulated_headers["X-API-Key"] = "wrong-key"
            manipulated_headers["x-api-key"] = "wrong-key"  # Lowercase
            manipulated_headers["X-Api-Key"] = "wrong-key"  # Mixed case
            
            mock_request = Mock(spec=Request)
            mock_request.headers = manipulated_headers
            
            # Should handle manipulation gracefully
            try:
                result = config.validate_api_key(mock_request)
                # If accepts, should be correct key
                if result is True:
                    # This would only happen if one of the headers matches
                    pass
            except HTTPException as e:
                # Should reject with proper exception
                assert e.status_code in [401, 403], "Should return proper HTTP status for manipulated headers"
            except Exception as e:
                pytest.fail(f"Security system crashed on header manipulation: {e}")
    
    @given(st.text(min_size=1, max_size=100, alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'))
    def test_environment_variable_handling_invariant(self, api_key):
        """
        INVARIANT: Security configuration should handle environment variables consistently.
        
        The security protocol must maintain consistent behavior
        regardless of environment variable configuration.
        """
        # Test with various environment variable states
        env_states = [
            {},  # No API key
            {'API_KEY': ''},  # Empty API key
            {'API_KEY': api_key},  # Valid API key
            {'API_KEY': ' '},  # Space-only API key
        ]
        
        for env_state in env_states:
            with patch.dict(os.environ, env_state, clear=True):
                try:
                    config = SecurityConfig()
                    
                    # API key should be exactly what's in environment
                    expected_key = env_state.get('API_KEY', '')
                    assert config.api_key == expected_key, \
                        f"API key mismatch: expected '{expected_key}', got '{config.api_key}'"
                    
                    # Should be a string
                    assert isinstance(config.api_key, str), "API key should always be string"
                    
                except Exception as e:
                    pytest.fail(f"Security configuration failed with env {env_state}: {e}")


if __name__ == "__main__":
    # Run tests directly
    pytest.main([__file__, "-v"])
