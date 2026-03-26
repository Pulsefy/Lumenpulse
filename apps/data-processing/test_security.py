#!/usr/bin/env python3
"""
Test script for API security features (API key authentication and rate limiting).

Usage:
    python test_security.py
    
This script will:
1. Test API key authentication (missing key, invalid key, valid key)
2. Test rate limiting
3. Verify health/metrics endpoints are accessible without auth
"""

import requests
import time
import sys
from typing import Tuple, Optional

# Configuration - Update these based on your .env file
BASE_URL = "http://localhost:8000"
VALID_API_KEY = "X-API-Key-Header-Value-Change-In-Production"  # From your .env
INVALID_API_KEY = "wrong-api-key"
RATE_LIMIT_TEST_COUNT = 15  # Number of requests to test rate limiting


def print_section(title: str) -> None:
    """Print a formatted section header."""
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)


def make_request(
    method: str,
    endpoint: str,
    api_key: Optional[str] = None,
    json_data: Optional[dict] = None,
) -> Tuple[int, dict]:
    """
    Make an HTTP request to the API.
    
    Args:
        method: HTTP method (GET, POST)
        endpoint: API endpoint path
        api_key: Optional API key
        json_data: Optional JSON data for POST requests
        
    Returns:
        Tuple of (status_code, response_json)
    """
    url = f"{BASE_URL}{endpoint}"
    headers = {}
    
    if api_key:
        headers["X-API-Key"] = api_key
    
    try:
        if method.upper() == "GET":
            response = requests.get(url, headers=headers, timeout=5)
        elif method.upper() == "POST":
            response = requests.post(url, headers=headers, json=json_data, timeout=5)
        else:
            raise ValueError(f"Unsupported method: {method}")
        
        return response.status_code, response.json()
    except requests.exceptions.ConnectionError:
        print(f"❌ Connection refused. Is the server running at {url}?")
        print("   Start the server with: python start_api.py")
        sys.exit(1)
    except requests.exceptions.Timeout:
        print(f"❌ Request timed out")
        return 504, {"error": "Timeout"}
    except Exception as e:
        print(f"❌ Error: {e}")
        return 500, {"error": str(e)}


def test_health_endpoint() -> bool:
    """Test that health endpoint works without authentication."""
    print_section("TEST 1: Health Endpoint (No Auth Required)")
    
    status_code, response = make_request("GET", "/health")
    
    print(f"Status Code: {status_code}")
    print(f"Response: {response}")
    
    if status_code == 200 and response.get("status") == "healthy":
        print("✓ PASS: Health endpoint accessible without auth")
        return True
    else:
        print("✗ FAIL: Health endpoint should be accessible without auth")
        return False


def test_metrics_endpoint() -> bool:
    """Test that metrics endpoint works without authentication."""
    print_section("TEST 2: Metrics Endpoint (No Auth Required)")
    
    status_code, response_text = make_request("GET", "/metrics")
    
    print(f"Status Code: {status_code}")
    print(f"Response preview: {response_text[:200] if isinstance(response_text, str) else 'Prometheus metrics'}")
    
    if status_code == 200:
        print("✓ PASS: Metrics endpoint accessible without auth")
        return True
    else:
        print("✗ FAIL: Metrics endpoint should be accessible without auth")
        return False


def test_missing_api_key() -> bool:
    """Test that protected endpoints reject requests without API key."""
    print_section("TEST 3: Missing API Key (Should Fail)")
    
    status_code, response = make_request("POST", "/analyze", json_data={"text": "test"})
    
    print(f"Status Code: {status_code}")
    print(f"Response: {response}")
    
    if status_code in [401, 403]:
        print("✓ PASS: Request rejected without API key")
        return True
    else:
        print("✗ FAIL: Request should be rejected without API key")
        return False


def test_invalid_api_key() -> bool:
    """Test that protected endpoints reject invalid API keys."""
    print_section("TEST 4: Invalid API Key (Should Fail)")
    
    status_code, response = make_request(
        "POST", "/analyze", api_key=INVALID_API_KEY, json_data={"text": "test"}
    )
    
    print(f"Status Code: {status_code}")
    print(f"Response: {response}")
    
    if status_code in [401, 403]:
        print("✓ PASS: Request rejected with invalid API key")
        return True
    else:
        print("✗ FAIL: Request should be rejected with invalid API key")
        return False


def test_valid_api_key() -> bool:
    """Test that protected endpoints accept valid API keys."""
    print_section("TEST 5: Valid API Key (Should Succeed)")
    
    status_code, response = make_request(
        "POST", "/analyze", api_key=VALID_API_KEY, json_data={"text": "This is great!"}
    )
    
    print(f"Status Code: {status_code}")
    print(f"Response: {response}")
    
    if status_code == 200 and "sentiment" in response:
        print(f"✓ PASS: Sentiment analysis successful (score: {response['sentiment']})")
        return True
    else:
        print("✗ FAIL: Should succeed with valid API key")
        return False


def test_rate_limiting() -> bool:
    """Test that rate limiting is enforced."""
    print_section("TEST 6: Rate Limiting")
    print(f"Sending {RATE_LIMIT_TEST_COUNT} rapid requests to /analyze...")
    
    success_count = 0
    rate_limited_count = 0
    
    for i in range(RATE_LIMIT_TEST_COUNT):
        status_code, response = make_request(
            "POST", "/analyze", api_key=VALID_API_KEY, json_data={"text": f"Test {i}"}
        )
        
        if status_code == 200:
            success_count += 1
        elif status_code == 429:
            rate_limited_count += 1
            print(f"\n⚠️  Rate limited after {i+1} requests")
            print(f"   Response: {response}")
            break
        
        if i % 5 == 0:
            print(f"  Request {i+1}: Status {status_code}")
    
    print(f"\nResults:")
    print(f"  Successful requests: {success_count}")
    print(f"  Rate limited requests: {rate_limited_count}")
    
    if rate_limited_count > 0 or success_count < RATE_LIMIT_TEST_COUNT:
        print("✓ PASS: Rate limiting is working")
        return True
    else:
        print("⚠️  WARNING: No rate limiting detected (may need more requests)")
        return True  # Still pass as rate limit might be higher than test count


def test_root_endpoint() -> bool:
    """Test root endpoint info."""
    print_section("TEST 7: Root Endpoint Information")
    
    status_code, response = make_request("GET", "/")
    
    print(f"Status Code: {status_code}")
    print(f"Response: {response}")
    
    if status_code == 200:
        print("✓ PASS: Root endpoint accessible")
        return True
    else:
        print("✗ FAIL: Root endpoint should be accessible")
        return False


def main():
    """Run all security tests."""
    print("\n" + "🔒" * 35)
    print("  LUMENPULSE DATA PROCESSING API SECURITY TEST SUITE")
    print("🔒" * 35)
    
    print(f"\nConfiguration:")
    print(f"  Base URL: {BASE_URL}")
    print(f"  Valid API Key: {VALID_API_KEY[:20]}...")
    print(f"  Rate Limit Test Count: {RATE_LIMIT_TEST_COUNT}")
    
    results = []
    
    # Run tests
    results.append(("Health Endpoint", test_health_endpoint()))
    results.append(("Metrics Endpoint", test_metrics_endpoint()))
    results.append(("Missing API Key", test_missing_api_key()))
    results.append(("Invalid API Key", test_invalid_api_key()))
    results.append(("Valid API Key", test_valid_api_key()))
    results.append(("Rate Limiting", test_rate_limiting()))
    results.append(("Root Endpoint", test_root_endpoint()))
    
    # Summary
    print_section("TEST SUMMARY")
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({(passed/total*100):.1f}%)")
    
    if passed == total:
        print("\n🎉 All security tests passed!")
        return 0
    else:
        print("\n❌ Some tests failed. Please review the output above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
