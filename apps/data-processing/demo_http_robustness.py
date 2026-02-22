import logging
import time
import requests_mock
from src.utils.http_client import RobustHTTPClient, http_breaker
from pybreaker import CircuitBreakerError

# Configure logging to see the structured output
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

def run_demo():
    client = RobustHTTPClient(base_url="https://flaky-api.com", max_retries=3)
    
    print("\n--- TEST 1: RETRY ON 500 SERVER ERROR ---")
    with requests_mock.Mocker() as m:
        # Mock: 2 failures then 1 success
        m.register_uri('GET', "https://flaky-api.com/retry", [
            {'text': 'Internal Server Error', 'status_code': 500},
            {'text': 'Internal Server Error', 'status_code': 500},
            {'json': {'data': 'Success after retries!'}, 'status_code': 200}
        ])
        
        print("Sending request to /retry (should fail twice, then succeed)...")
        start = time.time()
        response = client.get("/retry")
        duration = time.time() - start
        print(f"Result: {response.json()} (Took {duration:.2f}s)")

    print("\n--- TEST 2: RATE LIMITING (429) WITH RETRY-AFTER ---")
    with requests_mock.Mocker() as m:
        # Mock: 429 with Retry-After: 3
        m.register_uri('GET', "https://flaky-api.com/rate-limit", [
            {'text': 'Too Many Requests', 'status_code': 429, 'headers': {'Retry-After': '3'}},
            {'json': {'data': 'Success after waiting for rate limit!'}, 'status_code': 200}
        ])
        
        print("Sending request to /rate-limit (should wait 3 seconds)...")
        start = time.time()
        response = client.get("/rate-limit")
        duration = time.time() - start
        print(f"Result: {response.json()} (Took {duration:.2f}s)")

    print("\n--- TEST 3: CIRCUIT BREAKER TRIP ---")
    # Reset breaker first
    http_breaker.close()
    
    with requests_mock.Mocker() as m:
        # Register a persistent failure
        m.get("https://flaky-api.com/fail-forever", status_code=500)
        
        print("Triggering 5 failures to open the circuit...")
        for i in range(5):
            try:
                print(f"Attempt {i+1}...")
                client.get("/fail-forever")
            except Exception as e:
                print(f"  Caught expected error: {type(e).__name__}")
        
        print("\nNow the circuit should be OPEN. Next call should fail INSTANTLY without even hitting the network.")
        start = time.time()
        try:
            client.get("/fail-forever")
        except CircuitBreakerError:
            duration = time.time() - start
            print(f"Result: CircuitBreakerError caught! (Took {duration:.6f}s)")
        except Exception as e:
            print(f"Result: Unexpected error: {type(e).__name__}: {e}")

if __name__ == "__main__":
    run_demo()
